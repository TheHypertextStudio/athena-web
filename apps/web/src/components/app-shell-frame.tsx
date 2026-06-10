'use client';

import type { OrgSummary } from '@docket/types';
import {
  AppShell,
  ContextProvider,
  type HomeNavKey,
  Sidebar,
  TabBar,
  useContextState,
  type Workspace,
  type WorkspaceNavKey,
} from '@docket/ui/components';
import { VocabularyProvider } from '@docket/ui/hooks';
import { Search } from '@docket/ui/icons';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type JSX, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { ActiveOrgContext, useActiveOrg } from '@/components/active-org';
import { CommandPaletteProvider, useCommandPalette } from '@/components/command-palette';
import { OpenDocumentsProvider, useOpenDocuments } from '@/components/tabs';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { readError } from '@/lib/problem';

/** The cross-org Home destination implied by the current pathname (Today/Inbox/Portfolio). */
function homeKeyFromPath(pathname: string): HomeNavKey | undefined {
  if (/^\/today(?:\/|$)/.test(pathname)) return 'today';
  if (/^\/inbox(?:\/|$)/.test(pathname)) return 'inbox';
  if (/^\/portfolio(?:\/|$)/.test(pathname)) return 'portfolio';
  return undefined;
}

/** The org id embedded in an `(app)` route, or `null` for cross-org routes (Today/Inbox/…). */
function orgIdFromPath(pathname: string): string | null {
  const match = /^\/orgs\/([^/]+)(?:\/|$)/.exec(pathname);
  return match ? (match[1] ?? null) : null;
}

/**
 * The org-scoped sidebar destinations, in mvp-plan §7 order.
 *
 * @remarks
 * Each {@link WorkspaceNavKey} maps 1:1 to its route segment under `/orgs/[orgId]/…`, so the
 * href builder and {@link workspaceKeyFromPath} stay in lockstep with the real route tree.
 * Keeping them in one table is what guarantees the sidebar highlight and the navigation target
 * never drift apart as screens are added.
 */
const NAV_SEGMENTS: readonly WorkspaceNavKey[] = [
  'my-work',
  'triage',
  'initiatives',
  'programs',
  'projects',
  'cycles',
  'teams',
  'views',
  'agents',
  'settings',
];

/** The active Workspace nav key implied by the current org-scoped pathname. */
function workspaceKeyFromPath(pathname: string): WorkspaceNavKey | undefined {
  for (const key of NAV_SEGMENTS) {
    if (new RegExp(`^/orgs/[^/]+/${key}(?:/|$)`).test(pathname)) return key;
  }
  return undefined;
}

/** The `localStorage` key for a user's last-active workspace (persists across sessions). */
function lastOrgStorageKey(userId: string): string {
  return `docket:last-org:${userId}`;
}

/** Read the persisted last-active org id for a user, tolerating absent/blocked storage. */
function readLastOrg(userId: string | null): string | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(lastOrgStorageKey(userId));
  } catch {
    return null;
  }
}

/** Persist the last-active org id for a user, ignoring storage failures (quota/private mode). */
function writeLastOrg(userId: string | null, orgId: string): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(lastOrgStorageKey(userId), orgId);
  } catch {
    // Non-fatal: persistence is best-effort.
  }
}

/**
 * Resolve the active workspace for the flattened, Linear-style sidebar.
 *
 * @remarks
 * The sidebar's Workspace section is always present and stable, so it must reflect an org on
 * every route — including the cross-org Home routes (Today/Inbox/Portfolio) where no org is in
 * the path. Resolution order: the route's org, else the persisted last-used org (if the caller
 * still belongs to it), else the caller's personal space, else their first org. Returns `null`
 * only when the caller has no orgs at all.
 *
 * @param routeOrgId - The org id parsed from the path, or `null` on a cross-org route.
 * @param orgs - Every org the caller belongs to.
 * @param lastOrgId - The persisted last-used org id, if any.
 */
function resolveActiveOrg(
  routeOrgId: string | null,
  orgs: readonly OrgSummary[],
  lastOrgId: string | null,
): string | null {
  if (routeOrgId) return routeOrgId;
  if (orgs.length === 0) return null;
  if (lastOrgId && orgs.some((o) => o.id === lastOrgId)) return lastOrgId;
  const personal = orgs.find((o) => o.isPersonal);
  return personal?.id ?? orgs[0]?.id ?? null;
}

/**
 * The authenticated app-shell frame: the single flattened sidebar, the multi-document tab bar,
 * and the active workspace.
 *
 * @remarks
 * Mounted by the `(app)` route-group layout so every authenticated page shares one shell.
 * It gates access on the Better Auth session (redirecting to `/sign-in` when signed out) and
 * loads the caller's orgs once for the {@link Sidebar}'s workspace switcher. There is no
 * cross-org "Hub" mode that swaps the sidebar: the sidebar's Workspace section always reflects
 * the active workspace, resolved as route org ?? persisted last-used ?? personal space.
 *
 * The orgs and the bound org's vocabulary skin are exposed to descendant pages through
 * {@link useActiveOrg} so they can render org chips and resolve entity nouns without refetching.
 */
export function AppShellFrame({ children }: { children: ReactNode }): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, isPending } = authClient.useSession();

  const [orgs, setOrgs] = useState<readonly OrgSummary[]>([]);
  const [orgsError, setOrgsError] = useState<string | null>(null);

  const routeOrgId = orgIdFromPath(pathname);
  const userId = session?.user.id ?? null;

  // Redirect to sign-in once the session resolves to "signed out".
  useEffect(() => {
    if (!isPending && !session) router.replace('/sign-in');
  }, [isPending, session, router]);

  // Load the caller's orgs once a session is present (rides the session cookie).
  useEffect(() => {
    if (!session) return;
    const live = { current: true };
    void (async () => {
      try {
        const res = await api.v1.orgs.$get();
        if (!res.ok) {
          if (live.current) setOrgsError('Could not load your organizations.');
          return;
        }
        const { items } = await res.json();
        if (live.current) setOrgs(items);
      } catch (caught) {
        if (live.current) setOrgsError(readError(caught, 'Could not load your organizations.'));
      }
    })();
    return () => {
      live.current = false;
    };
  }, [session]);

  if (isPending || !session) {
    return (
      <main className="bg-surface text-on-surface-variant text-body flex min-h-screen items-center justify-center">
        Loading your workspace…
      </main>
    );
  }

  // Seed the context with the best guess available before orgs load: the route org, else the
  // persisted last-used org. The inner frame reconciles it to the full resolution once orgs
  // arrive — keeping the org accent stable from first paint instead of flashing on hydration.
  const initialOrgId = routeOrgId ?? readLastOrg(userId);

  return (
    <ContextProvider initialContext={initialOrgId}>
      <ActiveOrgContext orgs={orgs} activeOrgId={routeOrgId} orgsError={orgsError}>
        <CommandPaletteProvider>
          <OpenDocumentsProvider userId={userId}>
            <AppShellInner
              routeOrgId={routeOrgId}
              userId={userId}
              workspaceKey={workspaceKeyFromPath(pathname)}
              homeKey={homeKeyFromPath(pathname)}
            >
              {children}
            </AppShellInner>
          </OpenDocumentsProvider>
        </CommandPaletteProvider>
      </ActiveOrgContext>
    </ContextProvider>
  );
}

/** Props for {@link AppShellInner}. */
interface AppShellInnerProps {
  /** The org id bound to this route, or `null` on a cross-org route. */
  routeOrgId: string | null;
  /** The signed-in user's id; namespaces the persisted last-used workspace. */
  userId: string | null;
  /** The active Workspace nav key for the current route. */
  workspaceKey?: WorkspaceNavKey;
  /** The active Home destination for the current route (Today/Inbox/Portfolio). */
  homeKey?: HomeNavKey;
  /** The routed page content. */
  children: ReactNode;
}

/**
 * Render a Next `Link` carrying the row content (used by the sidebar + tab bar).
 *
 * @remarks
 * Shared by the {@link Sidebar} and the {@link TabBar}. The optional `className` lets the tab
 * bar hand the anchor its flex classes so the link becomes a real flex child of the tab row
 * (a flexing, truncating title with a right-pinned close button); the sidebar omits it. The
 * argument is optional so this single function satisfies both callers' `renderLink` contracts.
 */
function renderLink(href: string, content: ReactNode, className?: string): ReactNode {
  return (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}

/**
 * The shell body that lives inside the providers and wires shell selections to navigation.
 *
 * @remarks
 * Split from {@link AppShellFrame} because it must read the shell context, active-org state,
 * and open-documents store (only available inside their providers). The flattened sidebar
 * always shows both sections — the cross-org Home section and the active workspace's section —
 * so the active workspace is resolved as route org ?? persisted last-used ?? personal space and
 * mirrored into the shell context (driving the org accent + the Workspace section's hrefs).
 * Every selection navigates imperatively (a cross-org row to its page, an org to its My Work),
 * and the chosen org is persisted so it survives across sessions. Entity nouns in the Workspace
 * section are skinned to the *route* org via {@link VocabularyProvider}; on a cross-org route
 * they fall back to the default preset until the caller enters an org.
 */
function AppShellInner({
  routeOrgId,
  userId,
  workspaceKey,
  homeKey,
  children,
}: AppShellInnerProps): JSX.Element {
  const router = useRouter();
  const { setContext } = useContextState();
  const { orgs, skin } = useActiveOrg();
  const { openPalette } = useCommandPalette();
  const { tabs, activeKey, closeTab } = useOpenDocuments();
  const [unreadCount, setUnreadCount] = useState(0);

  const workspaces = useMemo<readonly Workspace[]>(
    () =>
      orgs.map((o) => ({
        id: o.id,
        name: o.name,
        avatar: o.avatar,
      })),
    [orgs],
  );

  // The persisted last-used workspace, read once on mount (re-reads on sign-in change).
  const [lastOrgId, setLastOrgId] = useState<string | null>(() => readLastOrg(userId));
  useEffect(() => {
    setLastOrgId(readLastOrg(userId));
  }, [userId]);

  // The active workspace for the flattened sidebar: route org ?? last-used ?? personal ?? first.
  const resolvedOrgId = useMemo(
    () => resolveActiveOrg(routeOrgId, orgs, lastOrgId),
    [routeOrgId, orgs, lastOrgId],
  );

  // Whether the resolved active workspace is the caller's personal space. Read from the SAME org
  // the Workspace section reflects so the sidebar's chrome (e.g. omitting Teams) always matches
  // the visible workspace. A personal space is the user's own space, not an organization — its
  // `isPersonal === true` is an engineering convenience that must not surface team-management UI.
  const resolvedOrgIsPersonal = useMemo(
    () => orgs.find((o) => o.id === resolvedOrgId)?.isPersonal ?? false,
    [orgs, resolvedOrgId],
  );

  // Mirror the resolved active workspace into the shell context — one-directional, never
  // reversing navigation. The context drives the org accent and the Workspace section's hrefs;
  // it follows the resolution (route ?? last-used ?? personal) so the sidebar's org section is
  // stable on every route, including the cross-org Home routes. Navigation is always driven
  // imperatively from the sidebar/switcher handlers below, so this never derives a `router.push`.
  useEffect(() => {
    if (resolvedOrgId) setContext(resolvedOrgId);
  }, [resolvedOrgId, setContext]);

  // Persist the resolved workspace so it is the last-used default on the next visit.
  useEffect(() => {
    if (resolvedOrgId) writeLastOrg(userId, resolvedOrgId);
  }, [resolvedOrgId, userId]);

  // Poll the caller's cross-org unread count for the Inbox row's attention badge.
  useEffect(() => {
    const live = { current: true };
    const refresh = async (): Promise<void> => {
      try {
        const res = await api.v1.notifications.count.$get();
        if (!res.ok) return;
        const { unread } = await res.json();
        if (live.current) setUnreadCount(unread);
      } catch {
        // Non-fatal: the badge simply stays at its last value.
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 60_000);
    return () => {
      live.current = false;
      clearInterval(interval);
    };
  }, []);

  /** Switch the active workspace from the switcher: persist it and route to its My Work. */
  const onSelectWorkspace = useCallback(
    (orgId: string): void => {
      setContext(orgId);
      writeLastOrg(userId, orgId);
      router.push(`/orgs/${orgId}/my-work`);
    },
    [router, setContext, userId],
  );

  const sidebar = (
    <Sidebar
      workspaces={workspaces}
      activeHomeKey={homeKey}
      activeWorkspaceKey={workspaceKey}
      unreadCount={unreadCount}
      hrefForHome={(key) => `/${key}`}
      hrefForWorkspace={(orgId, key) => `/orgs/${orgId}/${key}`}
      renderLink={renderLink}
      onSelectWorkspace={onSelectWorkspace}
      onOpenSearch={openPalette}
      personalWorkspace={resolvedOrgIsPersonal}
    />
  );

  const tabBar = (
    <TabBar tabs={tabs} activeKey={activeKey} renderLink={renderLink} onClose={closeTab} />
  );

  // The active workspace name for the mobile top bar (shown below `lg`); falls back to the
  // product name when no workspace has resolved yet.
  const activeWorkspaceName = useMemo(
    () => workspaces.find((w) => w.id === resolvedOrgId)?.name,
    [workspaces, resolvedOrgId],
  );

  const mobileBrand = (
    <span className="text-body truncate font-semibold">{activeWorkspaceName ?? 'Docket'}</span>
  );

  // A search affordance for the mobile top bar that opens the same command palette as the
  // sidebar's Search row.
  const mobileActions = (
    <button
      type="button"
      aria-label="Search"
      onClick={openPalette}
      className="text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface focus-visible:ring-ring flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <Search aria-hidden="true" className="size-5" />
    </button>
  );

  return (
    <VocabularyProvider skin={skin}>
      <AppShell
        sidebar={sidebar}
        tabBar={tabBar}
        mobileBrand={mobileBrand}
        mobileActions={mobileActions}
      >
        {children}
      </AppShell>
    </VocabularyProvider>
  );
}
