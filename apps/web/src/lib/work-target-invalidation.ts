import type { ViewTarget } from '@docket/work/view-contract';
import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query';

import { workTargetCollectionKey } from './query-keys';

const WORK_TARGET_CHANNEL_NAME = 'docket.work-target.v1';

/** The clone-safe part of one work-target invalidation shared with peer tabs. */
export type WorkTargetInvalidationHint = Pick<
  WorkTargetInvalidation,
  'target' | 'ownerOrganizationId'
>;

const invalidationListeners = new Set<(hint: WorkTargetInvalidationHint) => void>();
let invalidationChannel: BroadcastChannel | null = null;
let invalidationChannelDisabled = false;

/** The work target and owning workspace affected by one cache refresh. */
export interface WorkTargetInvalidation {
  readonly target: ViewTarget;
  readonly ownerOrganizationId: string;
  /** One authoritative query that the caller refreshes separately. */
  readonly excludeQueryKey?: QueryKey;
}

function isViewTarget(value: unknown): value is ViewTarget {
  return value === 'task' || value === 'project' || value === 'program' || value === 'initiative';
}

function parseInvalidationHint(value: unknown): WorkTargetInvalidationHint | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as { readonly target?: unknown; readonly ownerOrganizationId?: unknown };
  if (!isViewTarget(candidate.target) || typeof candidate.ownerOrganizationId !== 'string') {
    return null;
  }
  return { target: candidate.target, ownerOrganizationId: candidate.ownerOrganizationId };
}

function workTargetChannel(): BroadcastChannel | null {
  if (invalidationChannel !== null) return invalidationChannel;
  if (
    invalidationChannelDisabled ||
    typeof window === 'undefined' ||
    typeof BroadcastChannel === 'undefined'
  )
    return null;
  try {
    invalidationChannel = new BroadcastChannel(WORK_TARGET_CHANNEL_NAME);
  } catch {
    invalidationChannelDisabled = true;
    return null;
  }
  invalidationChannel.onmessage = (event: MessageEvent<unknown>) => {
    const hint = parseInvalidationHint(event.data);
    if (hint === null) return;
    for (const listener of invalidationListeners) listener(hint);
  };
  return invalidationChannel;
}

/** Subscribe one query client to work-target invalidations published by peer tabs. */
export function subscribeWorkTargetInvalidations(
  listener: (hint: WorkTargetInvalidationHint) => void,
): () => void {
  invalidationListeners.add(listener);
  workTargetChannel();
  return () => {
    invalidationListeners.delete(listener);
  };
}

function publishWorkTargetInvalidation(hint: WorkTargetInvalidationHint): void {
  try {
    workTargetChannel()?.postMessage(hint);
  } catch {
    try {
      invalidationChannel?.close();
    } catch {
      // Cross-tab refresh is optional. The local query client remains authoritative for this tab.
    }
    invalidationChannel = null;
    invalidationChannelDisabled = true;
  }
}

function beginsWith(queryKey: QueryKey, prefix: QueryKey): boolean {
  return prefix.every((segment, index) => queryKey[index] === segment);
}

function isTargetProjection(queryKey: QueryKey, target: ViewTarget): boolean {
  if (queryKey[0] !== 'org' || typeof queryKey[1] !== 'string') return false;
  const collection = workTargetCollectionKey(queryKey[1], target);
  if (!beginsWith(queryKey, collection)) return false;
  const projection = queryKey[collection.length];
  if (target === 'initiative' && projection === 'hierarchy-candidates') return true;
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
function invalidateLocalWorkTargetQueries(
  queryClient: QueryClient,
  invalidation: WorkTargetInvalidation,
): Promise<void> {
  const ownerCollection = workTargetCollectionKey(
    invalidation.ownerOrganizationId,
    invalidation.target,
  );
  const excludedQueryHash = invalidation.excludeQueryKey
    ? hashKey(invalidation.excludeQueryKey)
    : null;
  return queryClient.invalidateQueries({
    predicate: (query) =>
      query.queryHash !== excludedQueryHash &&
      (beginsWith(query.queryKey, ownerCollection) ||
        isTargetProjection(query.queryKey, invalidation.target)),
  });
}

/** Refresh one work collection locally and notify peer tabs that cache state changed. */
export function invalidateWorkTargetQueries(
  queryClient: QueryClient,
  invalidation: WorkTargetInvalidation,
): Promise<void> {
  publishWorkTargetInvalidation({
    target: invalidation.target,
    ownerOrganizationId: invalidation.ownerOrganizationId,
  });
  return invalidateLocalWorkTargetQueries(queryClient, invalidation);
}

/** Refresh a peer tab without publishing the received hint back to its sender. */
export function invalidateWorkTargetQueriesFromPeer(
  queryClient: QueryClient,
  invalidation: WorkTargetInvalidationHint,
): Promise<void> {
  return invalidateLocalWorkTargetQueries(queryClient, invalidation);
}
