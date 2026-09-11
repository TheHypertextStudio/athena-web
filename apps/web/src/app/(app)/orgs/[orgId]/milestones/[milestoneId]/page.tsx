/**
 * A Milestone's detail — server entry (SSR prefetch + hydration).
 *
 * @remarks
 * Prefetches the milestone with the caller's session cookie and dehydrates the exact query key the
 * client detail page reads, so the route never mounts a title-only snapshot while its document waits
 * for a second client request.
 *
 * The milestone's tasks and its project breadcrumb both come from the owning Project's work read,
 * which cannot be prefetched here: the `projectId` is only known once the milestone itself resolves.
 * The client fetches it as a dependent read.
 *
 * @see `docs/engineering/specs/data-layer.md` §7.
 */
import { HydrationBoundary } from '@tanstack/react-query';
import type { JSX } from 'react';

import { apiQueryOptions, unwrap } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';
import { dehydrate, getServerApi, getServerQueryClient } from '@/lib/query-server';

import MilestoneDetailClient from './milestone-detail-client';

/**
 * The Milestone detail page (Server Component).
 *
 * @param props - The route params (org and milestone ids, async in Next 16).
 * @returns The hydrated detail page.
 */
export default async function MilestoneDetailPage({
  params,
}: {
  params: Promise<{ orgId: string; milestoneId: string }>;
}): Promise<JSX.Element> {
  const { orgId, milestoneId } = await params;
  const queryClient = getServerQueryClient();
  const api = await getServerApi();

  // The roster the page's capability checks read. Two cheap, `STALE.static`, org-wide reads that
  // every surface shares — prefetching them here is what stops a cold open rendering its controls
  // inert while they resolve.
  const roster = [
    queryClient.prefetchQuery({
      queryKey: queryKeys.members(orgId),
      queryFn: () =>
        unwrap(
          () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
          'Could not load members.',
        ),
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.roles(orgId),
      queryFn: () =>
        unwrap(
          () => api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
          'Could not load roles.',
        ),
    }),
  ];

  await Promise.allSettled([
    queryClient.prefetchQuery(
      apiQueryOptions(
        queryKeys.milestone(orgId, milestoneId),
        () =>
          api.v1.orgs[':orgId'].milestones[':id'].$get({
            param: { orgId, id: milestoneId },
          }),
        'Could not load this milestone.',
      ),
    ),
    ...roster,
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <MilestoneDetailClient />
    </HydrationBoundary>
  );
}
