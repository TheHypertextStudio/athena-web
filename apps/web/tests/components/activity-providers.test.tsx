import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useVocabulary } from '@docket/ui/hooks';
import { useContextState } from '@docket/ui/components';
import { ActivityProviders } from '@/components/activity-providers';
import { useActiveOrg } from '@/components/active-org';
import type * as ShellUtils from '@/components/app-shell-utils';
const state = vi.hoisted(() => ({
  pathname: '/orgs/01ARZ3NDEKTSV4RRFFQ69G5FAW/work-templates/new',
}));
const personal = '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  routeOrg = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const orgs = [
  { id: personal, name: 'Personal', slug: 'personal', isPersonal: true },
  { id: routeOrg, name: 'Agency', slug: 'agency', isPersonal: false },
];
vi.mock('@/lib/app-location', () => ({ useAppLocation: () => ({ pathname: state.pathname }) }));
vi.mock('@/lib/query', () => ({
  STALE: { static: 1000 },
  queryKeys: {
    orgs: () => ['me', 'orgs'],
    organization: (id: string) => ['org', id, 'detail'],
    teams: (id: string) => ['org', id, 'teams'],
  },
  apiQueryOptions: (queryKey: readonly unknown[]) => ({ queryKey }),
  useApiQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => ({
    data:
      queryKey[0] === 'me'
        ? { items: orgs }
        : queryKey[2] === 'detail'
          ? { vocabulary: { preset: queryKey[1] === routeOrg ? 'agency' : 'startup' } }
          : { items: [] },
    isPending: false,
    isLoading: false,
    error: null,
  }),
}));
vi.mock('@/lib/api', () => ({ api: {} }));
vi.mock('@/components/use-authenticated-identity', () => ({
  useAuthenticatedIdentity: () => ({
    userId: 'viewer',
    status: 'authenticated',
    identitySwitching: false,
    session: { user: { id: 'viewer', name: 'Viewer', email: 'viewer@example.test' } },
  }),
}));
vi.mock('@/components/app-shell-utils', async (original) => ({
  ...(await original<typeof ShellUtils>()),
  readLastOrg: () => personal,
}));
vi.mock('@/components/create-object/create-object-provider', () => ({
  CreateObjectProvider: ({ children }: { children: ReactNode }) => children,
  CreationDestinationProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/resolved-account', () => ({
  ResolvedAccountProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/statuses/status-registry', () => ({
  StatusRegistryProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/tasks/create-task', () => ({ GlobalTaskComposer: () => null }));
vi.mock('@/components/pwa', () => ({ OfflineSyncRuntime: () => null }));
vi.mock('@/components/session-snapshot-persistence', () => ({
  SessionSnapshotPersistence: () => null,
}));
function Probe() {
  const active = useActiveOrg(),
    context = useContextState(),
    noun = useVocabulary('program');
  return (
    <output>
      {active.activeOrgId}:{context.activeOrgId}:{noun}
    </output>
  );
}
afterEach(cleanup);
it('binds the exact route organization and its vocabulary instead of the saved personal workspace', () => {
  state.pathname = `/orgs/${routeOrg}/work-templates/new`;
  render(
    <ActivityProviders initialSession={null}>
      <Probe />
    </ActivityProviders>,
  );
  expect(screen.getByText(`${routeOrg}:${routeOrg}:Retainer`)).toBeVisible();
});
it('rebinds activity organization and vocabulary on an activity destination change', () => {
  state.pathname = `/orgs/${routeOrg}/work-templates/new`;
  const view = render(
    <ActivityProviders initialSession={null}>
      <Probe />
    </ActivityProviders>,
  );
  state.pathname = `/orgs/${personal}/work-templates/01ARZ3NDEKTSV4RRFFQ69G5FAX`;
  view.rerender(
    <ActivityProviders initialSession={null}>
      <Probe />
    </ActivityProviders>,
  );
  expect(screen.getByText(`${personal}:${personal}:Program`)).toBeVisible();
});
it('preserves the saved workspace context for an organization-free planning activity', () => {
  state.pathname = '/plan/day';
  render(
    <ActivityProviders initialSession={null}>
      <Probe />
    </ActivityProviders>,
  );
  expect(screen.getByText(`${personal}:${personal}:Program`)).toBeVisible();
});
