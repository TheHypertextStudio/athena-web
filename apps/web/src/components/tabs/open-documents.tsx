'use client';

/**
 * The open-documents store — the multi-document tab model for the app shell.
 *
 * @remarks
 * Tracks the caller's open "documents" (task/project/… detail surfaces) as an ordered set of
 * tabs, mirroring an IDE/browser. It is the single source of truth the shell's {@link TabBar}
 * renders. Responsibilities:
 *
 * - **Open/activate on navigation.** Whenever the route resolves to a document detail
 *   ({@link tabRefFromPath}), the matching tab is opened (or moved to focus if already open)
 *   and marked active. This covers in-page links, the command palette, and direct URLs alike.
 * - **Title resolution.** A newly-opened tab starts with a stable placeholder, then its real
 *   title is fetched ({@link resolveTabTitle}) and patched in.
 * - **Close → neighbor.** Closing the active tab routes to its neighbor (or the org/Hub base
 *   when none remains), so closing never strands the caller on a dead route.
 * - **Persistence.** The open set is persisted to `sessionStorage`, keyed by the signed-in
 *   user, so tabs survive a reload within the session without leaking across accounts.
 *
 * The store is read through {@link useOpenDocuments}; the shell frame wires it to the
 * {@link TabBar} and the router.
 */
import { ULID_REGEX } from '@docket/types';
import type { OpenTab } from '@docket/ui/components';
import { readStoredJson, writeStoredJson } from '@docket/ui/lib/browser-storage';
import { useQueryClient } from '@tanstack/react-query';
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { useAppPathname } from '@/lib/app-location';
import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { resolveTabTitle, titleFromCache, titleFromNavigationSnapshot } from './resolve-title';
import { tabRefFromPath } from './route-tabs';
import { hrefForTab, parseTabRef, type TabRef, tabKey } from './types';

/** The controls + state exposed by {@link useOpenDocuments}. */
export interface OpenDocumentsValue {
  /** The open documents, in tab order. */
  readonly tabs: readonly OpenTab[];
  /** The active tab's key, or `undefined` when no document is in focus. */
  readonly activeKey: string | undefined;
  /** Close a tab by key (routes to a neighbor / base when the active tab closes). */
  readonly closeTab: (key: string) => void;
  /** Report a document's current name, so an open tab follows a rename. */
  readonly registerTitle: (ref: TabRef, title: string) => void;
}

/** Internal context; consumed only through {@link useOpenDocuments}. */
const OpenDocumentsContext = createContext<OpenDocumentsValue | null>(null);

/** The `sessionStorage` key for a user's open-documents set. */
function storageKey(userId: string): string {
  return `docket:open-tabs:${userId}`;
}

type PersistedTab = TabRef & {
  readonly title: string | null;
};

const TAB_TYPES = new Set<PersistedTab['type']>([
  'task',
  'project',
  'initiative',
  'program',
  'cycle',
  'session',
]);

/** Read the persisted tab set for a user, tolerating absent/corrupt storage. */
function readPersisted(userId: string): readonly OpenTab[] {
  const parsed = readStoredJson(storageKey(userId), 'session');
  if (!Array.isArray(parsed)) return [];
  // Keep only well-formed entries (defensive against schema drift across sessions). The org
  // and document ids must be real ULIDs, so any junk tab persisted before the route guard
  // landed — e.g. a stale "Session undefined" with `id: 'undefined'` — is dropped on hydration
  // rather than resurrected.
  return parsed.flatMap((value) => {
    const tab = parsePersistedTab(value);
    return tab === null ? [] : [newTab(tab, tab.title)];
  });
}

/** Parse one stored descriptor while tolerating corrupt or older session data. */
function parsePersistedTab(value: unknown): PersistedTab | null {
  if (typeof value !== 'object' || value === null) return null;
  const tab = value as Readonly<Record<string, unknown>>;
  const structurallyValid =
    typeof tab['type'] === 'string' &&
    TAB_TYPES.has(tab['type'] as PersistedTab['type']) &&
    typeof tab['id'] === 'string' &&
    typeof tab['orgId'] === 'string' &&
    // `null` is a legitimate stored value: a tab whose document could not be read is persisted
    // unnamed rather than named after its id, and re-resolves on the next visit.
    (typeof tab['title'] === 'string' || tab['title'] === null) &&
    ULID_REGEX.test(tab['id']) &&
    ULID_REGEX.test(tab['orgId']);
  if (!structurallyValid) return null;
  try {
    return {
      ...parseTabRef(
        tab['type'] as PersistedTab['type'],
        tab['orgId'] as string,
        tab['id'] as string,
      ),
      title: tab['title'] as string | null,
    };
  } catch {
    return null;
  }
}

/** Persist the tab set for a user, ignoring storage failures (quota/private mode). */
function persist(userId: string, tabs: readonly OpenTab[]): void {
  const descriptors: readonly PersistedTab[] = tabs.map(({ type, orgId, id, title }) => ({
    ...parseTabRef(type, orgId, id),
    title,
  }));
  writeStoredJson(storageKey(userId), descriptors, 'session');
}

/** Props for {@link OpenDocumentsProvider}. */
export interface OpenDocumentsProviderProps {
  /** The signed-in user's id; namespaces persistence so tabs never leak across accounts. */
  readonly userId: string | null;
  /** The subtree that reads the store via {@link useOpenDocuments}. */
  readonly children: ReactNode;
}

/**
 * Build a fresh {@link OpenTab} for a ref.
 *
 * @param ref - The document the tab points at.
 * @param title - Its name if already known (usually from the query cache), else `null`.
 * @returns The new tab.
 */
function newTab(ref: TabRef, title: string | null): OpenTab {
  return {
    key: tabKey(ref),
    type: ref.type,
    orgId: ref.orgId,
    id: ref.id,
    title,
    href: hrefForTab(ref),
  };
}

/** Whether a keydown selects an adjacent open document. */
function tabNavigationDirection(event: KeyboardEvent): -1 | 1 | null {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat ||
    event.shiftKey ||
    !event.altKey ||
    event.metaKey === event.ctrlKey
  ) {
    return null;
  }
  if (event.key === 'ArrowLeft') return -1;
  if (event.key === 'ArrowRight') return 1;
  return null;
}

/** Whether a keydown closes the currently active open document. */
function isCloseTabShortcut(event: KeyboardEvent): boolean {
  return (
    !event.defaultPrevented &&
    !event.isComposing &&
    !event.repeat &&
    !event.shiftKey &&
    !event.altKey &&
    event.metaKey !== event.ctrlKey &&
    event.key.toLowerCase() === 'w'
  );
}

/**
 * Provide the open-documents store and keep it synced with the route.
 *
 * @remarks
 * Mounted inside the `(app)` shell. It hydrates from `sessionStorage` for the signed-in user,
 * opens/activates a tab on every document-detail route, resolves titles in the background, and
 * persists changes. Closing the active tab routes to a neighbor or the org/Hub base.
 */
export function OpenDocumentsProvider({
  userId,
  children,
}: OpenDocumentsProviderProps): JSX.Element {
  const router = useRouter();
  const pathname = useAppPathname();
  const queryClient = useQueryClient();
  const [tabs, setTabs] = useState<readonly OpenTab[]>([]);

  // Hydrate from session storage when the user resolves (and reset on sign-out / user change).
  useEffect(() => {
    setTabs(userId ? readPersisted(userId) : []);
  }, [userId]);

  // Persist on every change for the current user, but skip the first persist run for a user.
  //
  // On a full page load the provider mounts with the stale empty `tabs` state *before* the
  // hydrate effect above has run, so persisting it would clobber the stored set before it could
  // be read back. `persistGuard` skips exactly that first commit per user; from then on every
  // change (hydrated set, opened tab, resolved title, close) is written through.
  const persistGuard = useRef<string | null>(null);
  useEffect(() => {
    if (!userId) return;
    if (persistGuard.current !== userId) {
      persistGuard.current = userId;
      return;
    }
    persist(userId, tabs);
  }, [userId, tabs]);

  const activeRef = useMemo(() => (userId ? tabRefFromPath(pathname) : null), [pathname, userId]);
  const activeKey = activeRef ? tabKey(activeRef) : undefined;

  // Open (or no-op if already open) the tab for the active document route, then resolve its
  // title in the background.
  //
  // The effect keys off the stable `pathname` string (not the freshly-built `activeRef`
  // object, whose identity changes every render). Resolution is fired at most once per key and
  // authenticated-user scope. Late results are ignored after the user changes, so work started
  // for one account cannot patch another account's tab state. Within the same scope, a late title
  // only patches a tab whose key is still open and never resurrects a closed tab.
  const resolvedRef = useRef(new Set<string>());
  /** Names reported by detail pages, kept so a report can arrive before its tab does. */
  const registeredTitles = useRef(new Map<string, string>());
  const resolvedUserRef = useRef(userId);
  const resolutionEpochRef = useRef(0);
  useEffect(() => {
    if (resolvedUserRef.current === userId) return;
    resolvedUserRef.current = userId;
    resolutionEpochRef.current += 1;
    resolvedRef.current.clear();
    registeredTitles.current.clear();
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const ref = tabRefFromPath(pathname);
    if (!ref) return;
    const key = tabKey(ref);

    // Usually there is nothing to fetch: arriving from a list, from search, or from the composer
    // that just created the document means its record is already cached, so the tab is named in
    // the same tick it appears instead of after a round trip spent showing something else.
    // A detail page's own `useRegisterTabTitle` effect commits before this provider's does —
    // child effects run first — so a page that already knows its name reports it before the tab
    // it names exists. Reading that report here is what makes the two orders equivalent.
    const cached =
      registeredTitles.current.get(key) ??
      titleFromNavigationSnapshot(ref) ??
      titleFromCache(queryClient, ref);
    setTabs((current) => {
      const existing = current.find((t) => t.key === key);
      if (!existing) return [...current, newTab(ref, cached)];
      // A rename can land while the tab is open; adopt a newer cached name over a stale one.
      if (cached === null || existing.title === cached) return current;
      return current.map((t) => (t.key === key ? { ...t, title: cached } : t));
    });
    if (cached !== null) {
      resolvedRef.current.add(key);
      return;
    }

    if (resolvedRef.current.has(key)) return;
    resolvedRef.current.add(key);
    const resolutionEpoch = resolutionEpochRef.current;
    void resolveTabTitle(ref).then((title) => {
      if (resolutionEpochRef.current !== resolutionEpoch) return;
      // A failed resolve leaves the title null, so the bar keeps labelling the tab by its kind
      // and the next visit tries again — rather than freezing an unhelpful name into storage.
      if (title === null) {
        resolvedRef.current.delete(key);
        return;
      }
      setTabs((current) => current.map((t) => (t.key === key ? { ...t, title } : t)));
    });
  }, [pathname, userId, queryClient]);

  /**
   * Adopt a document's real name once the page showing it knows one.
   *
   * @remarks
   * The store resolves titles independently, which is enough to name a tab but not to keep it
   * named: renaming a document from its own detail page left every open tab still showing the
   * old title, because nothing told the store anything had changed. This is that channel.
   */
  const registerTitle = useCallback((ref: TabRef, title: string): void => {
    const key = tabKey(ref);
    resolvedRef.current.add(key);
    registeredTitles.current.set(key, title);
    setTabs((current) =>
      current.some((t) => t.key === key && t.title !== title)
        ? current.map((t) => (t.key === key ? { ...t, title } : t))
        : current,
    );
  }, []);

  const closeTab = useCallback(
    (key: string): void => {
      const index = tabs.findIndex((t) => t.key === key);
      if (index === -1) return;
      const closed = tabs[index];
      const next = tabs.filter((t) => t.key !== key);
      resolvedRef.current.delete(key);
      registeredTitles.current.delete(key);
      setTabs(next);

      // Only the active tab's closing changes where we are; closing a background tab leaves the
      // route untouched. Routing happens outside the state update (never inside the `setTabs`
      // updater) so we don't trigger the router's state change while rendering this provider.
      if (key === activeKey) {
        const neighbor = next[index] ?? next[index - 1] ?? null;
        if (neighbor)
          router.push(hrefForTab(parseTabRef(neighbor.type, neighbor.orgId, neighbor.id)));
        else if (closed) router.push(`/orgs/${closed.orgId}/my-work`);
        else router.push('/today');
      }
    },
    [tabs, activeKey, router],
  );

  const navigateAdjacentTab = useCallback(
    (direction: -1 | 1): void => {
      if (tabs.length === 0) return;
      const activeIndex = tabs.findIndex((tab) => tab.key === activeKey);
      const targetIndex =
        activeIndex === -1
          ? direction === 1
            ? 0
            : tabs.length - 1
          : (activeIndex + direction + tabs.length) % tabs.length;
      const target = tabs[targetIndex];
      if (target) router.push(hrefForTab(parseTabRef(target.type, target.orgId, target.id)));
    },
    [tabs, activeKey, router],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const direction = tabNavigationDirection(event);
      if (direction !== null) {
        if (tabs.length === 0) return;
        event.preventDefault();
        navigateAdjacentTab(direction);
        return;
      }
      if (!isCloseTabShortcut(event) || activeKey === undefined) return;
      event.preventDefault();
      closeTab(activeKey);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [tabs.length, activeKey, closeTab, navigateAdjacentTab]);

  const value = useMemo<OpenDocumentsValue>(
    () => ({ tabs, activeKey, closeTab, registerTitle }),
    [tabs, activeKey, closeTab, registerTitle],
  );

  return <OpenDocumentsContext.Provider value={value}>{children}</OpenDocumentsContext.Provider>;
}

/**
 * Read the open-documents store.
 *
 * @returns the current {@link OpenDocumentsValue}.
 * @throws {Error} when called outside an {@link OpenDocumentsProvider}.
 */
export function useOpenDocuments(): OpenDocumentsValue {
  const value = useContext(OpenDocumentsContext);
  if (value === null) {
    throw new Error('useOpenDocuments must be used within an <OpenDocumentsProvider>.');
  }
  return value;
}

/**
 * Read the open-documents store if one is mounted.
 *
 * @returns The current {@link OpenDocumentsValue}, or `null` outside a provider.
 *
 * @remarks
 * For things a detail page does *for* the tab bar rather than *with* it — reporting its own name,
 * say. The store belongs to the app shell, so a page rendered outside it (a print view, an
 * embed, a focused test) should quietly do without one rather than fail to render at all.
 */
export function useOptionalOpenDocuments(): OpenDocumentsValue | null {
  return useContext(OpenDocumentsContext);
}
