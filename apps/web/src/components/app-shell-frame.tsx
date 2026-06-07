'use client';

import type { OrgSummary } from '@docket/types';
import {
  AppShell,
  ContextProvider,
  type HubRailKey,
  HUB_CONTEXT,
  type RailOrg,
  type SidebarNavKey,
  useContextState,
} from '@docket/ui/components';
import { VocabularyProvider } from '@docket/ui/hooks';
import { usePathname, useRouter } from 'next/navigation';
import { type JSX, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { ActiveOrgContext, useActiveOrg } from '@/components/active-org';
import { CommandPaletteProvider, useCommandPalette } from '@/components/command-palette';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { readError } from '@/lib/problem';

/** The Hub destination implied by the current cross-org pathname (Inbox/Portfolio). */
function hubKeyFromPath(pathname: string): HubRailKey | undefined {
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
 * Each {@link SidebarNavKey} maps 1:1 to its route segment under `/orgs/[orgId]/…`, so
 * {@link onNavigate} and {@link navKeyFromPath} stay in lockstep with the real route tree.
 * Keeping them in one table is what guarantees the sidebar highlight and the navigation
 * target never drift apart as screens are added.
 */
const NAV_SEGMENTS: readonly SidebarNavKey[] = [
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

/** The active sidebar nav key implied by the current org-scoped pathname. */
function navKeyFromPath(pathname: string): SidebarNavKey | undefined {
  for (const key of NAV_SEGMENTS) {
    if (new RegExp(`^/orgs/[^/]+/${key}(?:/|$)`).test(pathname)) return key;
  }
  return undefined;
}

/**
 * The authenticated app-shell frame: org rail, context sidebar, and the active context.
 *
 * @remarks
 * Mounted by the `(app)` route-group layout so every authenticated page shares one shell.
 * It gates access on the Better Auth session (redirecting to `/sign-in` when signed out),
 * loads the caller's orgs once for the {@link GlobalRail}, and binds the active context to
 * the route — the cross-org {@link HUB_CONTEXT} on `/today`, or the org id parsed from an
 * `/orgs/[orgId]/…` path. Rail and sidebar selections are translated into Next navigation.
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
          <AppShellInner
            activeOrgId={activeOrgId}
            navKey={navKeyFromPath(pathname)}
            hubKey={hubKeyFromPath(pathname)}
          >
            {children}
          </AppShellInner>
        </CommandPaletteProvider>
      </ActiveOrgContext>
    </ContextProvider>
  );
}

/** Props for {@link AppShellInner}. */
interface AppShellInnerProps {
  /** The org id bound to this route, or `null` on the Hub. */
  activeOrgId: string | null;
  /** The active sidebar nav key for the current route. */
  navKey?: SidebarNavKey;
  /** The active Hub rail destination for the current route (Inbox/Portfolio). */
  hubKey?: HubRailKey;
  /** The routed page content. */
  children: ReactNode;
}

/**
 * The shell body that lives inside the providers and wires shell selections to navigation.
 *
 * @remarks
 * Split from {@link AppShellFrame} because it must read the shell context and active-org
 * state (only available inside their providers). The route is the single source of truth: a
 * one-directional effect mirrors it into the bound context, while every rail and palette
 * selection navigates imperatively (Hub → `/today`, Inbox/Portfolio → `/[key]`, org →
 * `/orgs/[id]/my-work`). It also maps sidebar nav keys to org-scoped routes and skins entity
 * nouns to the bound org via {@link VocabularyProvider}.
 */
function AppShellInner({ activeOrgId, navKey, hubKey, children }: AppShellInnerProps): JSX.Element {
  const router = useRouter();
  const { setContext } = useContextState();
  const { orgs, skin } = useActiveOrg();
  const { openPalette } = useCommandPalette();
  const [unreadCount, setUnreadCount] = useState(0);

  const railOrgs = useMemo<readonly RailOrg[]>(
    () => orgs.map((o) => ({ id: o.id, name: o.name, avatar: o.avatar })),
    [orgs],
  );

  // Mirror the route into the bound context — one-directional, never reversing navigation.
  //
  // This is the *only* coupling between the route and the context: the route is the source of
  // truth, and the context follows it. Navigation is always driven imperatively from the rail
  // and palette handlers below; the shell never derives a `router.push` from context state.
  // (An earlier effect that pushed routes when `context` diverged from the route raced this
  // sync — `activeOrgId` updates on the route change before `setContext` flushes — and bounced
  // org → Hub navigation back to the org or to `/today`. Routing from the handlers removes the
  // divergence the effect was watching for.)
  useEffect(() => {
    setContext(activeOrgId ?? HUB_CONTEXT);
  }, [activeOrgId, setContext]);

  // Poll the caller's cross-org unread count for the rail's Inbox attention badge.
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

  /** Translate a sidebar nav selection into an org-scoped route. */
  const onNavigate = useCallback(
    (key: SidebarNavKey): void => {
      if (!activeOrgId) {
        router.push('/today');
        return;
      }
      router.push(`/orgs/${activeOrgId}/${key}`);
    },
    [activeOrgId, router],
  );

  /** Translate a Hub rail destination selection into its cross-org route. */
  const onNavigateHub = useCallback(
    (key: HubRailKey): void => {
      router.push(`/${key}`);
    },
    [router],
  );

  /** Translate an org-avatar selection into that org's home route (context rebind is handled by the rail). */
  const onSelectOrg = useCallback(
    (orgId: string): void => {
      router.push(`/orgs/${orgId}/my-work`);
    },
    [router],
  );

  /** The Hub (Today) button routes to Today even from another cross-org surface. */
  const onSelectHome = useCallback((): void => {
    router.push('/today');
  }, [router]);

  /** The add-org affordance routes to onboarding. */
  const onAddOrg = useCallback((): void => {
    router.push('/onboarding');
  }, [router]);

  return (
    <VocabularyProvider skin={skin}>
      <AppShell
        orgs={railOrgs}
        activeNavKey={navKey}
        activeHubKey={hubKey}
        unreadCount={unreadCount}
        onNavigate={onNavigate}
        onNavigateHub={onNavigateHub}
        onSelectOrg={onSelectOrg}
        onSelectHome={onSelectHome}
        onOpenSearch={openPalette}
        onAddOrg={onAddOrg}
      >
        {children}
      </AppShell>
    </VocabularyProvider>
  );
}
