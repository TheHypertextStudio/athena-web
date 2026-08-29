import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { queryKeys } from '@/lib/query-keys';
import { invalidateWorkTargetQueries } from '@/lib/work-target-invalidation';

function testClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

interface ObservedQuery {
  queryKey: readonly unknown[];
  queryFn: ReturnType<typeof vi.fn<() => Promise<{ source: string }>>>;
}

function observeSeededQueries(
  queryClient: QueryClient,
  definitions: readonly ObservedQuery[],
): readonly (() => void)[] {
  return definitions.map(({ queryKey, queryFn }) => {
    queryClient.setQueryData(queryKey, { source: 'seed' });
    const observer = new QueryObserver(queryClient, {
      queryKey,
      queryFn,
      staleTime: Infinity,
    });
    return observer.subscribe(() => undefined);
  });
}

describe('work target invalidation', () => {
  it('refetches the active Initiative collection family without touching Project work views', async () => {
    const queryClient = testClient();
    const initiativeOverview = vi.fn(async () => ({ source: 'initiative-overview' }));
    const initiativeRoster = vi.fn(async () => ({ source: 'initiative-roster' }));
    const initiativeFacets = vi.fn(async () => ({ source: 'initiative-facets' }));
    const projectRoster = vi.fn(async () => ({ source: 'project-roster' }));
    const definitions = [
      {
        queryKey: queryKeys.initiatives('route-a'),
        queryFn: initiativeOverview,
      },
      {
        queryKey: queryKeys.workView(
          'route-a',
          'initiative',
          'builtin:initiative:route-a',
          'request',
          'America/Los_Angeles',
        ),
        queryFn: initiativeRoster,
      },
      {
        queryKey: queryKeys.workViewFacets(
          'route-a',
          'initiative',
          'builtin:initiative:route-a',
          'facets',
          'America/Los_Angeles',
        ),
        queryFn: initiativeFacets,
      },
      {
        queryKey: queryKeys.workView(
          'route-a',
          'project',
          'builtin:project:route-a',
          'request',
          'America/Los_Angeles',
        ),
        queryFn: projectRoster,
      },
    ] as const satisfies readonly ObservedQuery[];
    const unsubscribes = observeSeededQueries(queryClient, definitions);

    await queryClient.invalidateQueries({ queryKey: queryKeys.initiatives('route-a') });

    expect(initiativeOverview).toHaveBeenCalledTimes(1);
    expect(initiativeRoster).toHaveBeenCalledTimes(1);
    expect(initiativeFacets).toHaveBeenCalledTimes(1);
    expect(projectRoster).not.toHaveBeenCalled();
    for (const unsubscribe of unsubscribes) unsubscribe();
  });

  it('refetches each cached cross-workspace Initiative projection and the owner overview once', async () => {
    const queryClient = testClient();
    const ownerOverview = vi.fn(async () => ({ source: 'owner-overview' }));
    const routeRoster = vi.fn(async () => ({ source: 'route-roster' }));
    const routeFacets = vi.fn(async () => ({ source: 'route-facets' }));
    const projectRoster = vi.fn(async () => ({ source: 'project-roster' }));
    const definitions = [
      {
        queryKey: queryKeys.initiatives('owner-b'),
        queryFn: ownerOverview,
      },
      {
        queryKey: queryKeys.workView(
          'route-a',
          'initiative',
          'builtin:initiative:route-a',
          'request',
          'America/Los_Angeles',
        ),
        queryFn: routeRoster,
      },
      {
        queryKey: queryKeys.workViewFacets(
          'route-a',
          'initiative',
          'builtin:initiative:route-a',
          'facets',
          'America/Los_Angeles',
        ),
        queryFn: routeFacets,
      },
      {
        queryKey: queryKeys.workView(
          'route-a',
          'project',
          'builtin:project:route-a',
          'request',
          'America/Los_Angeles',
        ),
        queryFn: projectRoster,
      },
    ] as const satisfies readonly ObservedQuery[];
    const unsubscribes = observeSeededQueries(queryClient, definitions);

    const invalidation = invalidateWorkTargetQueries(queryClient, {
      target: 'initiative',
      ownerOrganizationId: 'owner-b',
    });

    expect(invalidation).toBeInstanceOf(Promise);
    await invalidation;
    expect(ownerOverview).toHaveBeenCalledTimes(1);
    expect(routeRoster).toHaveBeenCalledTimes(1);
    expect(routeFacets).toHaveBeenCalledTimes(1);
    expect(projectRoster).not.toHaveBeenCalled();
    for (const unsubscribe of unsubscribes) unsubscribe();
  });
});
