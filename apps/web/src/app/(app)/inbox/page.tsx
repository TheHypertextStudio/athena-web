/**
 * The cross-org Inbox — server entry (SSR prefetch + hydration).
 *
 * @remarks
 * Prefetches the Inbox's three Hub feeds (notifications, pending-approval count, activity) with the
 * caller's session cookie, dehydrates them, and hands the warm cache to {@link InboxClient} via
 * `<HydrationBoundary>` — so the inbox paints from data on first load, not a skeleton, then keeps
 * itself live via the client's focus-only polling. A failed prefetch degrades gracefully (the
 * client fetches that feed). See `docs/engineering/specs/data-layer.md` §7.
 */
import { HydrationBoundary } from '@tanstack/react-query';
import type { JSX } from 'react';

import { unwrap } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';
import { dehydrate, getServerApi, getServerQueryClient } from '@/lib/query-server';

import InboxClient from './inbox-client';

/** The number of activity events prefetched — matches the client's `ACTIVITY_PAGE_SIZE`. */
const ACTIVITY_PAGE_SIZE = 50;

/**
 * The Inbox page (Server Component).
 *
 * @returns the hydrated inbox.
 */
export default async function InboxPage(): Promise<JSX.Element> {
  const queryClient = getServerQueryClient();
  const api = await getServerApi();

  await Promise.allSettled([
    queryClient.prefetchQuery({
      queryKey: queryKeys.notifications(),
      queryFn: () =>
        unwrap(() => api.v1.notifications.$get({ query: {} }), 'Could not load your inbox.'),
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.notificationsCount(),
      queryFn: () => unwrap(() => api.v1.notifications.count.$get(), 'Could not load your inbox.'),
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.activity(),
      queryFn: () =>
        unwrap(
          () =>
            api.v1.hub.activity.$get({
              query: { limit: String(ACTIVITY_PAGE_SIZE), order: 'desc' },
            }),
          'Could not load activity.',
        ),
    }),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <InboxClient />
    </HydrationBoundary>
  );
}
