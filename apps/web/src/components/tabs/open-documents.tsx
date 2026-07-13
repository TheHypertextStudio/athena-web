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
import { usePathname, useRouter } from 'next/navigation';
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

import { fallbackTitle, resolveTabTitle } from './resolve-title';
import { tabRefFromPath } from './route-tabs';
import { hrefForTab, type TabRef, tabKey } from './types';

/** The controls + state exposed by {@link useOpenDocuments}. */
export interface OpenDocumentsValue {
  /** The open documents, in tab order. */
  readonly tabs: readonly OpenTab[];
  /** The active tab's key, or `undefined` when no document is in focus. */
  readonly activeKey: string | undefined;
  /** Close a tab by key (routes to a neighbor / base when the active tab closes). */
  readonly closeTab: (key: string) => void;
}

/** Internal context; consumed only through {@link useOpenDocuments}. */
const OpenDocumentsContext = createContext<OpenDocumentsValue | null>(null);

/** The `sessionStorage` key for a user's open-documents set. */
function storageKey(userId: string): string {
  return `docket:open-tabs:${userId}`;
}

/** Read the persisted tab set for a user, tolerating absent/corrupt storage. */
function readPersisted(userId: string): readonly OpenTab[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Keep only well-formed entries (defensive against schema drift across sessions). The org
    // and document ids must be real ULIDs, so any junk tab persisted before the route guard
    // landed — e.g. a stale "Session undefined" with `id: 'undefined'` — is dropped on hydration
    // rather than resurrected.
    return parsed.filter((t): t is OpenTab => {
      if (typeof t !== 'object' || t === null) return false;
      const tab = t as OpenTab;
      return (
        typeof tab.key === 'string' &&
        typeof tab.id === 'string' &&
        typeof tab.orgId === 'string' &&
        typeof tab.href === 'string' &&
        typeof tab.title === 'string' &&
        ULID_REGEX.test(tab.id) &&
        ULID_REGEX.test(tab.orgId)
      );
    });
  } catch {
    return [];
  }
}

/** Persist the tab set for a user, ignoring storage failures (quota/private mode). */
function persist(userId: string, tabs: readonly OpenTab[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(storageKey(userId), JSON.stringify(tabs));
  } catch {
    // Non-fatal: persistence is best-effort.
  }
}

/** Props for {@link OpenDocumentsProvider}. */
export interface OpenDocumentsProviderProps {
  /** The signed-in user's id; namespaces persistence so tabs never leak across accounts. */
  readonly userId: string | null;
  /** The subtree that reads the store via {@link useOpenDocuments}. */
  readonly children: ReactNode;
}

/** Build a fresh {@link OpenTab} for a ref with a placeholder title (resolved later). */
function newTab(ref: TabRef): OpenTab {
  return {
    key: tabKey(ref),
    type: ref.type,
    orgId: ref.orgId,
    id: ref.id,
    title: fallbackTitle(ref),
    href: hrefForTab(ref),
  };
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
  const pathname = usePathname();
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
  const resolvedUserRef = useRef(userId);
  const resolutionEpochRef = useRef(0);
  useEffect(() => {
    if (resolvedUserRef.current === userId) return;
    resolvedUserRef.current = userId;
    resolutionEpochRef.current += 1;
    resolvedRef.current.clear();
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const ref = tabRefFromPath(pathname);
    if (!ref) return;
    const key = tabKey(ref);
    setTabs((current) =>
      current.some((t) => t.key === key) ? current : [...current, newTab(ref)],
    );

    if (resolvedRef.current.has(key)) return;
    resolvedRef.current.add(key);
    const resolutionEpoch = resolutionEpochRef.current;
    void resolveTabTitle(ref).then((title) => {
      if (resolutionEpochRef.current !== resolutionEpoch) return;
      setTabs((current) => current.map((t) => (t.key === key ? { ...t, title } : t)));
    });
  }, [pathname, userId]);

  const closeTab = useCallback(
    (key: string): void => {
      const index = tabs.findIndex((t) => t.key === key);
      if (index === -1) return;
      const closed = tabs[index];
      const next = tabs.filter((t) => t.key !== key);
      resolvedRef.current.delete(key);
      setTabs(next);

      // Only the active tab's closing changes where we are; closing a background tab leaves the
      // route untouched. Routing happens outside the state update (never inside the `setTabs`
      // updater) so we don't trigger the router's state change while rendering this provider.
      if (key === activeKey) {
        const neighbor = next[index] ?? next[index - 1] ?? null;
        if (neighbor) router.push(neighbor.href);
        else if (closed) router.push(`/orgs/${closed.orgId}/my-work`);
        else router.push('/today');
      }
    },
    [tabs, activeKey, router],
  );

  const value = useMemo<OpenDocumentsValue>(
    () => ({ tabs, activeKey, closeTab }),
    [tabs, activeKey, closeTab],
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
