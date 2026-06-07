'use client';

import type { OrgSummary } from '@docket/types';
import {
  AppShell,
  ContextProvider,
  HUB_CONTEXT,
  type RailOrg,
  type SidebarNavKey,
  useContextState,
} from '@docket/ui/components';
import { VocabularyProvider } from '@docket/ui/hooks';
import { usePathname, useRouter } from 'next/navigation';
import { type JSX, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { ActiveOrgContext, useActiveOrg } from '@/components/active-org';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { readError } from '@/lib/problem';

/** The org id embedded in an `(app)` route, or `null` for cross-org (Hub) routes. */
function orgIdFromPath(pathname: string): string | null {
  const match = /^\/orgs\/([^/]+)(?:\/|$)/.exec(pathname);
  return match ? (match[1] ?? null) : null;
}

/** The active sidebar nav key implied by the current org-scoped pathname. */
function navKeyFromPath(pathname: string): SidebarNavKey | undefined {
  if (/^\/orgs\/[^/]+\/projects(?:\/|$)/.test(pathname)) return 'projects';
  if (/^\/orgs\/[^/]+\/my-work(?:\/|$)/.test(pathname)) return 'my-work';
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
        <AppShellInner activeOrgId={activeOrgId} navKey={navKeyFromPath(pathname)}>
          {children}
        </AppShellInner>
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
  /** The routed page content. */
  children: ReactNode;
}

/**
 * The shell body that lives inside the providers and wires shell selections to navigation.
 *
 * @remarks
 * Split from {@link AppShellFrame} because it must read the shell context and active-org
 * state (only available inside their providers). It keeps the bound context in step with the
 * route, turns rail context rebinds into navigation (Hub → `/today`, org → `/orgs/[id]/my-work`),
 * maps sidebar nav keys to org-scoped routes, and skins entity nouns to the bound org via
 * {@link VocabularyProvider}.
 */
function AppShellInner({ activeOrgId, navKey, children }: AppShellInnerProps): JSX.Element {
  const router = useRouter();
  const { context, setContext } = useContextState();
  const { orgs, skin } = useActiveOrg();

  const railOrgs = useMemo<readonly RailOrg[]>(
    () => orgs.map((o) => ({ id: o.id, name: o.name, avatar: o.avatar })),
    [orgs],
  );

  // Keep the bound context aligned to the route on navigation.
  useEffect(() => {
    setContext(activeOrgId ?? HUB_CONTEXT);
  }, [activeOrgId, setContext]);

  // When the rail rebinds the context, navigate to that destination.
  useEffect(() => {
    const target = activeOrgId ?? HUB_CONTEXT;
    if (context === target) return;
    router.push(context === HUB_CONTEXT ? '/today' : `/orgs/${context}/my-work`);
  }, [context, activeOrgId, router]);

  /** Translate a sidebar nav selection into an org-scoped route. */
  const onNavigate = useCallback(
    (key: SidebarNavKey): void => {
      if (!activeOrgId) {
        router.push('/today');
        return;
      }
      router.push(
        key === 'projects' ? `/orgs/${activeOrgId}/projects` : `/orgs/${activeOrgId}/my-work`,
      );
    },
    [activeOrgId, router],
  );

  /** The add-org affordance routes to onboarding. */
  const onAddOrg = useCallback((): void => {
    router.push('/onboarding');
  }, [router]);

  return (
    <VocabularyProvider skin={skin}>
      <AppShell orgs={railOrgs} activeNavKey={navKey} onNavigate={onNavigate} onAddOrg={onAddOrg}>
        {children}
      </AppShell>
    </VocabularyProvider>
  );
}
