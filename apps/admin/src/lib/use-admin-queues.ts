'use client';

import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, STALE, useLiveApiQuery } from '@/lib/query';
import type { NavCounter } from '@/components/admin-nav';

/**
 * How often the sidebar re-reads queue depth while the console has focus.
 *
 * @remarks
 * A minute, not a few seconds. These badges say roughly how much is waiting, and they are mounted
 * on every admin route — so the interval is a per-tab, forever cost paid mostly on screens that
 * render neither number.
 */
const QUEUE_POLL_MS = 60_000;

/** The depth of each queue the sidebar surfaces as an attention badge. */
export type AdminQueueCounts = Readonly<Record<NavCounter, number | undefined>>;

/**
 * The discount applications awaiting a finance decision.
 *
 * @remarks
 * The queue screen's own read. It is deliberately *not* what the sidebar badge polls: this returns
 * every waiting application in full — organization name, program key, evidence type, institutional
 * email, EIN — from an unbounded join, and a badge needs only how many there are. The count comes
 * from the metrics response instead.
 */
export const discountQueueDef = apiQueryOptions(
  queryKeys.discounts(),
  () => api.admin['discount-applications'].$get(),
  'Could not load the discount queue.',
  { staleTime: STALE.volatile },
);

/**
 * Headline platform metrics: totals, per-lifecycle org counts, and the operator queue signals.
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
 * One request, polled only while the document has focus, so a console left open in a background tab
 * stops talking to the API. Both counts come out of the metrics response: the lifecycle buckets it
 * already returned, and the discount-review signal that now sits beside the other triage counts —
 * so badging them costs nothing beyond the read the dashboard makes anyway.
 *
 * A count stays `undefined` until the read succeeds. A failed or still-loading queue renders no
 * badge rather than a `0`, because "nothing waiting" and "we could not find out" are different
 * facts and an operator must never read the second as the first.
 *
 * @returns the current depth of each badged queue.
 */
export function useAdminQueues(): AdminQueueCounts {
  const metrics = useLiveApiQuery(metricsDef, QUEUE_POLL_MS);

  return {
    discountReviews: metrics.data?.queues.pendingDiscountReviews,
    pendingDeletion: metrics.data?.orgsByLifecycle.find(
      (bucket) => bucket.lifecycleState === 'pending_deletion',
    )?.count,
  };
}
