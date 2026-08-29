import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { refreshRestoredProject } from '../../../src/app/(app)/orgs/[orgId]/projects/[projectId]/project-detail-client';

function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('Project restore invalidation', () => {
  it('fetches an inactive aggregate before it reports restored data ready', async () => {
    const queryClient = createQueryClient();
    const aggregateQuery = {
      queryKey: ['org', 'org-1', 'projects', 'project-1', 'aggregate-detail'] as const,
      queryFn: vi.fn(async () => ({ revision: 'fresh' })),
    };
    queryClient.setQueryData(aggregateQuery.queryKey, { revision: 'stale' });

    await expect(
      refreshRestoredProject({
        queryClient,
        aggregateQuery,
        ownerOrganizationId: 'org-1',
      }),
    ).resolves.toBe('ready');

    expect(aggregateQuery.queryFn).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(aggregateQuery.queryKey)).toEqual({ revision: 'fresh' });
    expect(queryClient.getQueryState(aggregateQuery.queryKey)?.isInvalidated).toBe(false);
  });

  it('fetches a missing aggregate before it reports restored data ready', async () => {
    const queryClient = createQueryClient();
    const aggregateQuery = {
      queryKey: ['org', 'org-1', 'projects', 'project-1', 'aggregate-detail'] as const,
      queryFn: vi.fn(async () => ({ revision: 'fresh' })),
    };

    await expect(
      refreshRestoredProject({
        queryClient,
        aggregateQuery,
        ownerOrganizationId: 'org-1',
      }),
    ).resolves.toBe('ready');

    expect(aggregateQuery.queryFn).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(aggregateQuery.queryKey)).toEqual({ revision: 'fresh' });
  });

  it('uses the invalidation refetch once when the aggregate is active', async () => {
    const queryClient = createQueryClient();
    const aggregateQuery = {
      queryKey: ['org', 'org-1', 'projects', 'project-1', 'aggregate-detail'] as const,
      queryFn: vi.fn(async () => ({ revision: 'fresh' })),
    };
    queryClient.setQueryData(aggregateQuery.queryKey, { revision: 'stale' });
    const observer = new QueryObserver(queryClient, { ...aggregateQuery, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => undefined);

    try {
      await expect(
        refreshRestoredProject({
          queryClient,
          aggregateQuery,
          ownerOrganizationId: 'org-1',
        }),
      ).resolves.toBe('ready');

      expect(aggregateQuery.queryFn).toHaveBeenCalledOnce();
      expect(queryClient.getQueryData(aggregateQuery.queryKey)).toEqual({ revision: 'fresh' });
    } finally {
      unsubscribe();
    }
  });

  it('does not retry a failed invalidation refetch when the aggregate is active', async () => {
    const queryClient = createQueryClient();
    const aggregateQuery = {
      queryKey: ['org', 'org-1', 'projects', 'project-1', 'aggregate-detail'] as const,
      queryFn: vi.fn(async () => Promise.reject(new Error('provider text must not escape'))),
    };
    queryClient.setQueryData(aggregateQuery.queryKey, { revision: 'stale' });
    const observer = new QueryObserver(queryClient, { ...aggregateQuery, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => undefined);

    try {
      await expect(
        refreshRestoredProject({
          queryClient,
          aggregateQuery,
          ownerOrganizationId: 'org-1',
        }),
      ).resolves.toBe('cache-error');

      expect(aggregateQuery.queryFn).toHaveBeenCalledOnce();
    } finally {
      unsubscribe();
    }
  });

  it('reports an aggregate cache error when the authoritative fetch fails', async () => {
    const queryClient = createQueryClient();
    const aggregateQuery = {
      queryKey: ['org', 'org-1', 'projects', 'project-1', 'aggregate-detail'] as const,
      queryFn: vi.fn(async () => Promise.reject(new Error('provider text must not escape'))),
    };
    queryClient.setQueryData(aggregateQuery.queryKey, { revision: 'stale' });

    await expect(
      refreshRestoredProject({
        queryClient,
        aggregateQuery,
        ownerOrganizationId: 'org-1',
      }),
    ).resolves.toBe('cache-error');

    expect(aggregateQuery.queryFn).toHaveBeenCalledOnce();
  });

  it('reports a cache error when the target invalidation itself rejects', async () => {
    const queryClient = createQueryClient();
    vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValue(
      new Error('internal cache failure'),
    );
    const aggregateQuery = {
      queryKey: ['org', 'org-1', 'projects', 'project-1', 'aggregate-detail'] as const,
      queryFn: vi.fn(async () => ({ revision: 'fresh' })),
    };

    await expect(
      refreshRestoredProject({
        queryClient,
        aggregateQuery,
        ownerOrganizationId: 'org-1',
      }),
    ).resolves.toBe('cache-error');

    expect(aggregateQuery.queryFn).not.toHaveBeenCalled();
  });
});
