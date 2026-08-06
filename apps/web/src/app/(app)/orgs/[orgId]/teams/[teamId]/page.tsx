/**
 * The team page — server entry (SSR prefetch + hydration).
 *
 * @remarks
 * Prefetches the team, its display metadata, its roster and its activity report with the caller's
 * session cookie, then hands the warm cache to {@link TeamDetailClient}, so the page paints from
 * data rather than from a skeleton. A failed prefetch degrades to the client fetching that slice.
 * See `docs/engineering/specs/data-layer.md` §7.
 */
import { HydrationBoundary } from '@tanstack/react-query';
import type { JSX } from 'react';

import { unwrap } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';
import { dehydrate, getServerApi, getServerQueryClient } from '@/lib/query-server';

import TeamDetailClient from './team-detail-client';

/**
 * The team detail page (Server Component).
 *
 * @param props - The route params (org and team ids, async in Next 16).
 * @returns the hydrated page.
 */
export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ orgId: string; teamId: string }>;
}): Promise<JSX.Element> {
  const { orgId, teamId } = await params;
  const queryClient = getServerQueryClient();
  const api = await getServerApi();

  await Promise.allSettled([
    queryClient.prefetchQuery({
      queryKey: queryKeys.team(orgId, teamId),
      queryFn: () =>
        unwrap(
          () => api.v1.orgs[':orgId'].teams[':teamId'].$get({ param: { orgId, teamId } }),
          'Could not load this team.',
        ),
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.entityDisplay(orgId, 'team', teamId),
      queryFn: () =>
        unwrap(
          () =>
            api.v1.orgs[':orgId'].display[':subjectType'][':subjectId'].$get({
              param: { orgId, subjectType: 'team', subjectId: teamId },
            }),
          'Could not load this team’s icon.',
        ),
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.teamMembers(orgId, teamId),
      queryFn: () =>
        unwrap(
          () => api.v1.orgs[':orgId'].teams[':teamId'].members.$get({ param: { orgId, teamId } }),
          'Could not load this team’s people.',
        ),
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.teamActivity(orgId, teamId),
      queryFn: () =>
        unwrap(
          () => api.v1.orgs[':orgId'].teams[':teamId'].activity.$get({ param: { orgId, teamId } }),
          'Could not load this team’s activity.',
        ),
    }),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TeamDetailClient />
    </HydrationBoundary>
  );
}
