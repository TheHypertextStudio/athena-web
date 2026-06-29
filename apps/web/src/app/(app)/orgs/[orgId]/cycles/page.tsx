/**
 * The org Cycles list — server entry (SSR prefetch + hydration).
 *
 * @remarks
 * The cycles roster keys off the org's team ids (the fetcher ensures each team's rolling window
 * before reading), so this entry resolves teams first, seeds the shared teams cache (which the
 * app-shell `ActiveOrgContext` reads under the same {@link queryKeys.teams} key — so it hydrates
 * warm too), then prefetches the cycles roster + per-cycle stats under the exact team-id-keyed key
 * the client uses (`[...queryKeys.cycles, ...teamIds]`, same id order). It dehydrates the lot and
 * hands the warm cache to {@link CyclesClient} via `<HydrationBoundary>`. A failed prefetch (or a
 * teams read that doesn't resolve) degrades gracefully — the client fetches. See
 * `docs/engineering/specs/data-layer.md` §7.
 */
import type { TeamOut } from '@docket/types';
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

  // Resolve teams first: the cycles key embeds the team ids, and the app shell reads the same key.
  await queryClient.prefetchQuery({
    queryKey: queryKeys.teams(orgId),
    queryFn: () =>
      unwrap(() => api.v1.orgs[':orgId'].teams.$get({ param: { orgId } }), 'Could not load teams.'),
  });

  // Only prime the roster when teams resolved — its key + the fetcher's ensure step both need them.
  const teamsData = queryClient.getQueryData<{ items: readonly TeamOut[] }>(queryKeys.teams(orgId));
  if (teamsData) {
    const teamIds = teamsData.items.map((t) => t.id);
    await queryClient.prefetchQuery({
      queryKey: [...queryKeys.cycles(orgId), ...teamIds],
      queryFn: () =>
        unwrap(fetchCyclesWithStats(orgId, teamIds, api), 'Could not load your cycles.'),
    });
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <CyclesClient />
    </HydrationBoundary>
  );
}
