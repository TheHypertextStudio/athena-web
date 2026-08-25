/**
 * A Project's detail — server entry (SSR prefetch + hydration).
 *
 * @remarks
 * Prefetches the bounded aggregate with the caller's session cookie and dehydrates the exact query
 * key the client detail page reads. The page therefore paints the document it fetched rather than
 * an identity-only transition shell.
 *
 * @see `docs/engineering/specs/data-layer.md` §7.
 */
import { HydrationBoundary } from '@tanstack/react-query';
import type { JSX } from 'react';

import { unwrap } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';
import { apiQueryOptions } from '@/lib/query';
import { dehydrate, getServerApi, getServerQueryClient } from '@/lib/query-server';

import ProjectDetailClient from './project-detail-client';

/**
 * The Project detail page (Server Component).
 *
 * @param props - The route params (org and project ids, async in Next 16).
 * @returns The hydrated detail page.
 */
export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ orgId: string; projectId: string }>;
}): Promise<JSX.Element> {
  const { orgId, projectId } = await params;
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
        queryKeys.projectAggregate(orgId, projectId),
        () =>
          api.v1.orgs[':orgId'].projects[':id']['aggregate-detail'].$get({
            param: { orgId, id: projectId },
          }),
        'Could not refresh this project.',
      ),
    ),
    ...roster,
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProjectDetailClient />
    </HydrationBoundary>
  );
}
