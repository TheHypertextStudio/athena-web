'use client';

import type { OrgSummary } from '@docket/types';
import {
  AppShell,
  ContextProvider,
  type HomeNavKey,
  HUB_CONTEXT,
  Sidebar,
  TabBar,
  useContextState,
  type Workspace,
  type WorkspaceNavKey,
} from '@docket/ui/components';
import { VocabularyProvider } from '@docket/ui/hooks';
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

/** The org id embedded in an `(app)` route, or `null` for cross-org (Hub) routes. */
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

/**
 * The authenticated app-shell frame: the single integrated sidebar, the multi-document tab
 * bar, and the active context.
 *
 * @remarks
 * Mounted by the `(app)` route-group layout so every authenticated page shares one shell.
 * It gates access on the Better Auth session (redirecting to `/sign-in` when signed out),
 * loads the caller's orgs once for the {@link Sidebar}'s workspace switcher, and binds the
 * active context to the route — the cross-org {@link HUB_CONTEXT} on the Home surfaces, or the
 * org id parsed from an `/orgs/[orgId]/…` path. Sidebar and tab selections are translated into
 * Next navigation.
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

  const activeOrgId = orgIdFromPath(pathname);
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
      <main className="bg-background text-muted-foreground flex min-h-screen items-center justify-center text-sm">
        Loading your workspace…
      </main>
    );
  }

  return (
    <ContextProvider initialContext={activeOrgId ?? HUB_CONTEXT}>
      <ActiveOrgContext orgs={orgs} activeOrgId={activeOrgId} orgsError={orgsError}>
        <CommandPaletteProvider>
          <OpenDocumentsProvider userId={userId}>
            <AppShellInner
              activeOrgId={activeOrgId}
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
  /** The org id bound to this route, or `null` on the Hub. */
  activeOrgId: string | null;
  /** The active Workspace nav key for the current route. */
  workspaceKey?: WorkspaceNavKey;
  /** The active Home destination for the current route (Today/Inbox/Portfolio). */
  homeKey?: HomeNavKey;
  /** The routed page content. */
  children: ReactNode;
}

/** Render a Next `Link` carrying the row content (used by the sidebar + tab bar `asChild`). */
function renderLink(href: string, content: ReactNode): ReactNode {
  return <Link href={href}>{content}</Link>;
}

/**
 * The shell body that lives inside the providers and wires shell selections to navigation.
 *
 * @remarks
 * Split from {@link AppShellFrame} because it must read the shell context, active-org state,
 * and open-documents store (only available inside their providers). The route is the single
 * source of truth: a one-directional effect mirrors it into the bound context, while every
 * sidebar/switcher selection navigates imperatively (Hub → `/today`, an org → its My Work).
 * Entity nouns are skinned to the bound org via {@link VocabularyProvider}.
 */
function AppShellInner({
  activeOrgId,
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
        isPersonal: o.isPersonal,
      })),
    [orgs],
  );

  // Mirror the route into the bound context — one-directional, never reversing navigation.
  //
  // This is the *only* coupling between the route and the context: the route is the source of
  // truth, and the context follows it. Navigation is always driven imperatively from the
  // sidebar/switcher handlers below; the shell never derives a `router.push` from context
  // state, which is what keeps switching workspaces from racing the route-to-context sync.
  useEffect(() => {
    setContext(activeOrgId ?? HUB_CONTEXT);
  }, [activeOrgId, setContext]);

  // Poll the caller's cross-org unread count for the switcher's Hub badge + the Inbox row.
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

  /** Switch the active workspace: the Hub (`null`) routes to Today, an org to its My Work. */
  const onSelectWorkspace = useCallback(
    (orgId: string | null): void => {
      setContext(orgId ?? HUB_CONTEXT);
      router.push(orgId ? `/orgs/${orgId}/my-work` : '/today');
    },
    [router, setContext],
  );

  /** The add-org affordance routes to onboarding. */
  const onAddOrg = useCallback((): void => {
    router.push('/onboarding');
  }, [router]);

  const sidebar = (
    <Sidebar
      workspaces={workspaces}
      activeHomeKey={homeKey}
      activeWorkspaceKey={workspaceKey}
      unreadCount={unreadCount}
      hrefForHome={(key) => `/${key}`}
      hrefForWorkspace={(orgId, key) => `/orgs/${orgId}/${key}`}
      hrefForOrgHome={(orgId) => `/orgs/${orgId}/my-work`}
      renderLink={renderLink}
      onSelectWorkspace={onSelectWorkspace}
      onOpenSearch={openPalette}
      onAddOrg={onAddOrg}
    />
  );

  const tabBar = (
    <TabBar tabs={tabs} activeKey={activeKey} renderLink={renderLink} onClose={closeTab} />
  );

  return (
    <VocabularyProvider skin={skin}>
      <AppShell sidebar={sidebar} tabBar={tabBar}>
        {children}
      </AppShell>
    </VocabularyProvider>
  );
}
