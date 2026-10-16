'use client';

import { ContextProvider, PageScrollProvider, useContextState } from '@docket/ui/components';
import { VocabularyProvider } from '@docket/ui/hooks';
import { type JSX, type ReactNode, type ComponentProps, useEffect } from 'react';
import { ActiveOrgContext, useActiveOrg } from '@/components/active-org';
import { useAppLocation } from '@/lib/app-location';
import { parseAuthenticatedRoute } from '@/lib/authenticated-route';
import { readDensity, readLastOrg, resolveActiveOrg } from '@/components/app-shell-utils';
import {
  CreateObjectProvider,
  CreationDestinationProvider,
} from '@/components/create-object/create-object-provider';
import { GlobalTaskComposer } from '@/components/tasks/create-task';
import { OfflineSyncRuntime } from '@/components/pwa';
import { ReachabilityProvider } from '@/components/reachability';
import { ResolvedAccountProvider } from '@/components/resolved-account';
import { SessionSnapshotPersistence } from '@/components/session-snapshot-persistence';
import { useAuthenticatedIdentity } from '@/components/use-authenticated-identity';
import { api } from '@/lib/api';
import { fetchAllOrganizations } from '@/lib/org-collection-pages';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import { userErrorMessage } from '@/lib/problem';
import type { ServerSessionUser } from '@/lib/server-session';
import { usePersistedDensity } from '@/hooks/use-persisted-density';

function useActivityRouteOrg(): string | null {
  const { pathname } = useAppLocation();
  const match = parseAuthenticatedRoute(pathname);
  return match.kind === 'matched' && 'orgId' in match.route.params
    ? match.route.params.orgId
    : null;
}

/** Authenticated activity dependencies without application navigation, tabs, palette, or rails. */
export function ActivityProviders({
  initialSession,
  children,
}: {
  readonly initialSession: ServerSessionUser | null;
  readonly children: ReactNode;
}): JSX.Element {
  const identity = useAuthenticatedIdentity(initialSession);
  const routeOrgId = useActivityRouteOrg();
  const orgsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.orgs(),
      () => fetchAllOrganizations(api),
      'Could not load your workspaces.',
      {
        enabled: !identity.identitySwitching && Boolean(identity.userId),
        staleTime: STALE.static,
      },
    ),
  );
  const orgs = identity.identitySwitching ? [] : (orgsQ.data?.items ?? []);
  const initialOrgId = resolveActiveOrg(routeOrgId, orgs, null);
  const rejected = identity.status === 'signed-out' || identity.identitySwitching;
  return (
    <ContextProvider key={identity.userId} initialContext={initialOrgId}>
      <ReachabilityProvider reachable={identity.status !== 'unreachable'}>
        <ActivityOrgScope
          orgs={orgs}
          orgsLoading={orgsQ.isPending}
          orgsError={
            orgsQ.error ? userErrorMessage(orgsQ.error, 'Could not load your workspaces.') : null
          }
        >
          <OfflineSyncRuntime userId={identity.userId} />
          <SessionSnapshotPersistence
            identity={
              identity.status === 'authenticated' && identity.session
                ? {
                    userId: identity.session.user.id,
                    name: identity.session.user.name,
                    email: identity.session.user.email,
                    image: identity.session.user.image ?? null,
                  }
                : null
            }
          />
          <ResolvedAccountProvider userId={rejected ? null : identity.userId}>
            <ActivityWorkspace userId={identity.userId}>
              {rejected ? null : children}
            </ActivityWorkspace>
          </ResolvedAccountProvider>
        </ActivityOrgScope>
      </ReachabilityProvider>
    </ContextProvider>
  );
}

function ActivityWorkspace({
  userId,
  children,
}: {
  readonly userId: string | null;
  readonly children: ReactNode;
}): JSX.Element {
  const { orgs, skin } = useActiveOrg();
  const routeOrgId = useActivityRouteOrg();
  const { setContext, setDensity } = useContextState();
  const density = usePersistedDensity(userId);
  useEffect(() => {
    setContext(routeOrgId ?? resolveActiveOrg(null, orgs, readLastOrg(userId)));
    setDensity(userId ? density : readDensity(null));
  }, [orgs, userId, density, routeOrgId, setContext, setDensity]);
  return (
    <VocabularyProvider skin={skin}>
      <CreateObjectProvider>
        <PageScrollProvider>{children}</PageScrollProvider>
        <CreationDestinationProvider>
          <GlobalTaskComposer />
        </CreationDestinationProvider>
      </CreateObjectProvider>
    </VocabularyProvider>
  );
}

function ActivityOrgScope(
  props: Omit<ComponentProps<typeof ActiveOrgContext>, 'activeOrgId'>,
): JSX.Element {
  const { activeOrgId } = useContextState();
  const routeOrgId = useActivityRouteOrg();
  return <ActiveOrgContext {...props} activeOrgId={routeOrgId ?? activeOrgId} />;
}
