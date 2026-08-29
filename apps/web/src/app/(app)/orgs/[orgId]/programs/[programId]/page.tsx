/**
 * A Program's detail — server entry (SSR prefetch + hydration).
 *
 * @remarks
 * Prefetches the bounded aggregate with the caller's session cookie and dehydrates the exact query
 * key the client detail page reads. This prevents a route from mounting a title-only snapshot while
 * its document waits for a second client request.
 *
 * @see `docs/engineering/specs/data-layer.md` §7.
 */
import { HydrationBoundary } from '@tanstack/react-query';
import type { JSX } from 'react';

import { apiQueryOptions, unwrap } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';
import { apiQueryOptions } from '@/lib/query-core';
import { dehydrate, getServerApi, getServerQueryClient } from '@/lib/query-server';

import ProgramDetailClient from './program-detail-client';

/**
 * The Program detail page (Server Component).
 *
 * @param props - The route params (org and program ids, async in Next 16).
 * @returns The hydrated detail page.
 */
export default async function ProgramDetailPage({
  params,
}: {
  params: Promise<{ orgId: string; programId: string }>;
}): Promise<JSX.Element> {
  const { orgId, programId } = await params;
  const queryClient = getServerQueryClient();
  const api = await getServerApi();

  // The roster the page's capability checks read. Two cheap, `STALE.static`, org-wide reads that
  // every list surface shares — prefetching them here is what stops a cold open rendering its
  // controls inert while they resolve.
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
        queryKeys.programAggregate(orgId, programId),
        () =>
          api.v1.orgs[':orgId'].programs[':id']['aggregate-detail'].$get({
            param: { orgId, id: programId },
          }),
        'Could not refresh this program.',
      ),
    ),
    ...roster,
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProgramDetailClient />
    </HydrationBoundary>
  );
}
