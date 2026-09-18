/**
 * The cross-workspace Drafts page — server entry (SSR prefetch + hydration).
 *
 * @remarks
 * Prefetches the person's drafts with the caller's session cookie so the list paints from data on
 * first load. A failed prefetch degrades to the client fetching it. See
 * `docs/engineering/specs/data-layer.md` §7.
 */
import { HydrationBoundary } from '@tanstack/react-query';
import type { JSX } from 'react';

import { unwrap } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';
import { dehydrate, getServerApi, getServerQueryClient } from '@/lib/query-server';

import DraftsClient from './drafts-client';

/**
 * The Drafts page (Server Component).
 *
 * @returns the hydrated drafts list.
 */
export default async function DraftsPage(): Promise<JSX.Element> {
  const queryClient = getServerQueryClient();
  const api = await getServerApi();

  await Promise.allSettled([
    queryClient.prefetchQuery({
      queryKey: queryKeys.drafts(),
      queryFn: () =>
        unwrap(() => api.v1.me.drafts.$get({ query: {} }), 'Could not load your drafts.'),
    }),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DraftsClient />
    </HydrationBoundary>
  );
}
