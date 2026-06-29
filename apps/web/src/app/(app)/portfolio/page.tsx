/**
 * The cross-org Portfolio — server entry (SSR prefetch + hydration).
 *
 * @remarks
 * Prefetches the aggregated roadmap (`hub.portfolio`) with the caller's session cookie, dehydrates
 * it, and hands the warm cache to {@link PortfolioClient} via `<HydrationBoundary>` — so the
 * swimlanes paint from data on first load, not a skeleton. A failed prefetch degrades gracefully
 * (the client fetches it). See `docs/engineering/specs/data-layer.md` §7.
 */
import { HydrationBoundary } from '@tanstack/react-query';
import type { JSX } from 'react';

import { unwrap } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';
import { dehydrate, getServerApi, getServerQueryClient } from '@/lib/query-server';

import PortfolioClient from './portfolio-client';

/**
 * The Portfolio page (Server Component).
 *
 * @returns the hydrated portfolio.
 */
export default async function PortfolioPage(): Promise<JSX.Element> {
  const queryClient = getServerQueryClient();
  const api = await getServerApi();

  await queryClient.prefetchQuery({
    queryKey: queryKeys.portfolio(),
    queryFn: () =>
      unwrap(() => api.v1.hub.portfolio.$get({ query: {} }), 'Could not load your portfolio.'),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <PortfolioClient />
    </HydrationBoundary>
  );
}
