import type { ViewTarget } from '@docket/work/view-contract';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

import { workTargetCollectionKey } from './query-keys';

/** The work target and owning workspace affected by one cache refresh. */
export interface WorkTargetInvalidation {
  readonly target: ViewTarget;
  readonly ownerOrganizationId: string;
}

function beginsWith(queryKey: QueryKey, prefix: QueryKey): boolean {
  return prefix.every((segment, index) => queryKey[index] === segment);
}

function isTargetProjection(queryKey: QueryKey, target: ViewTarget): boolean {
  if (queryKey[0] !== 'org' || typeof queryKey[1] !== 'string') return false;
  const collection = workTargetCollectionKey(queryKey[1], target);
  if (!beginsWith(queryKey, collection)) return false;
  const projection = queryKey[collection.length];
  return (
    (projection === 'work-view' || projection === 'work-view-facets') &&
    queryKey[collection.length + 1] === target
  );
}

/**
 * Refresh one work collection and its cached cross-workspace roster projections.
 *
 * @remarks
 * A route workspace can project entities owned by another workspace. The owner collection prefix
 * refreshes its own overview and local projections. The predicate also finds cached roster and
 * facet projections for the same target under every route workspace. TanStack refetches active
 * matches and marks inactive matches stale through the single invalidation pass.
 *
 * @param queryClient - The cache that owns the collection and projection queries.
 * @param invalidation - The changed target and the workspace that owns it.
 * @returns A promise that settles after every active matching query has refetched.
 */
export function invalidateWorkTargetQueries(
  queryClient: QueryClient,
  invalidation: WorkTargetInvalidation,
): Promise<void> {
  const ownerCollection = workTargetCollectionKey(
    invalidation.ownerOrganizationId,
    invalidation.target,
  );
  return queryClient.invalidateQueries({
    predicate: (query) =>
      beginsWith(query.queryKey, ownerCollection) ||
      isTargetProjection(query.queryKey, invalidation.target),
  });
}
