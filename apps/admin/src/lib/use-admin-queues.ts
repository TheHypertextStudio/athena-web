'use client';

import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, STALE, useLiveApiQuery } from '@/lib/query';
import type { NavCounter } from '@/components/admin-nav';

/** How often the sidebar re-reads queue depth while the console has focus. */
const QUEUE_POLL_MS = 30_000;

/** The depth of each queue the sidebar surfaces as an attention badge. */
export type AdminQueueCounts = Readonly<Record<NavCounter, number | undefined>>;

/** The discount applications currently awaiting a finance decision. */
export const discountQueueDef = apiQueryOptions(
  queryKeys.discounts(),
  () => api.admin['discount-applications'].$get(),
  'Could not load the discount queue.',
  { staleTime: STALE.volatile },
);

/**
 * Headline platform metrics, including the per-lifecycle org counts and the operator queue
 * signals.
 *
 * @remarks
 * Shared with the dashboard rather than duplicated: both read this one definition, so the sidebar
 * badge and the dashboard render the same numbers from one cache entry and one request.
 */
export const metricsDef = apiQueryOptions(
  queryKeys.metrics(),
  () => api.admin.metrics.$get(),
  'Could not load platform metrics.',
  { staleTime: STALE.volatile },
);

/**
 * Read the queue depths the sidebar badges.
 *
 * @remarks
 * Polls only while the document has focus, so a console left open in a background tab stops
 * talking to the API. A count stays `undefined` until its read succeeds — a failed or still-loading
 * queue renders no badge rather than a `0`, because "zero waiting" and "we could not find out" are
 * different facts, and an operator must never read the second as the first.
 *
 * The deletion count comes from the metrics response's `orgsByLifecycle` bucket rather than a
 * second org query, so badging it costs no extra request.
 *
 * @returns the current depth of each badged queue.
 */
export function useAdminQueues(): AdminQueueCounts {
  const discounts = useLiveApiQuery(discountQueueDef, QUEUE_POLL_MS);
  const metrics = useLiveApiQuery(metricsDef, QUEUE_POLL_MS);

  return {
    discountReviews: discounts.data?.items.length,
    pendingDeletion: metrics.data?.orgsByLifecycle.find(
      (bucket) => bucket.lifecycleState === 'pending_deletion',
    )?.count,
  };
}
