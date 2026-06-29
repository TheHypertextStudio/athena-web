/**
 * The org Cycles list — server entry (SSR prefetch + hydration).
 *
 * @remarks
 * Prefetches the cycles roster (the list endpoint auto-rolls each team's window server-side and
 * returns per-cycle stats inline, so this is a single read under {@link queryKeys.cycles}) plus the
 * org's teams — the latter only so the app-shell `ActiveOrgContext` and the client's filter/group
 * catalog hydrate warm under the same {@link queryKeys.teams} key. The two are independent
 * (`allSettled`); a failed prefetch degrades to a client fetch. Dehydrates the lot and hands the
 * warm cache to {@link CyclesClient} via `<HydrationBoundary>`. See
 * `docs/engineering/specs/data-layer.md` §7.
 */
import { HydrationBoundary } from '@tanstack/react-query';
import type { JSX } from 'react';

import { fetchCyclesWithStats } from '@/lib/fetch-cycles-with-stats';
import { unwrap } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';
import { dehydrate, getServerApi, getServerQueryClient } from '@/lib/query-server';

import CyclesClient from './cycles-client';

/**
 * The Cycles list page (Server Component).
 *
 * @param props - The route params (the active org id, async in Next 16).
 * @returns the hydrated roster.
 */
export default async function CyclesListPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): Promise<JSX.Element> {
  const { orgId } = await params;
  const queryClient = getServerQueryClient();
  const api = await getServerApi();

  await Promise.allSettled([
    queryClient.prefetchQuery({
      queryKey: queryKeys.cycles(orgId),
      queryFn: () => unwrap(fetchCyclesWithStats(orgId, api), 'Could not load your cycles.'),
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.teams(orgId),
      queryFn: () =>
        unwrap(
          () => api.v1.orgs[':orgId'].teams.$get({ param: { orgId } }),
          'Could not load teams.',
        ),
    }),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <CyclesClient />
    </HydrationBoundary>
  );
}
