/**
 * The org Initiatives list — server entry (SSR prefetch + hydration).
 *
 * @remarks
 * Prefetches the enriched initiatives roster (each row joined with its detail roll-up) with the
 * caller's session cookie — via the now-client-agnostic {@link fetchEnrichedInitiatives}, passing
 * the server client — dehydrates it, and hands the warm cache to {@link InitiativesListClient} via
 * `<HydrationBoundary>`. The client reads the same `queryKeys.initiatives` key (with the browser
 * client) and hydrates. A failed prefetch degrades gracefully. See `docs/engineering/specs/data-layer.md` §7.
 */
import { HydrationBoundary } from '@tanstack/react-query';
import type { JSX } from 'react';

import { fetchEnrichedInitiatives } from '@/components/initiatives/initiative-fetcher';
import { unwrap } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';
import { dehydrate, getServerApi, getServerQueryClient } from '@/lib/query-server';

import InitiativesListClient from './initiatives-client';

/**
 * The Initiatives list page (Server Component).
 *
 * @param props - The route params (the active org id, async in Next 16).
 * @returns the hydrated roster.
 */
export default async function InitiativesListPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): Promise<JSX.Element> {
  const { orgId } = await params;
  const queryClient = getServerQueryClient();
  const api = await getServerApi();

  await queryClient.prefetchQuery({
    queryKey: queryKeys.initiatives(orgId),
    queryFn: () => unwrap(fetchEnrichedInitiatives(orgId, api), 'Could not load initiatives.'),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <InitiativesListClient />
    </HydrationBoundary>
  );
}
