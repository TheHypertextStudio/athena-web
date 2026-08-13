/**
 * A Project's detail — server entry (SSR prefetch + hydration).
 *
 * @remarks
 * Prefetches the project's own row with the caller's session cookie, dehydrates it, and hands the
 * warm cache to the client page. That is enough for the masthead — icon, name, summary, property
 * row — to be in the first paint, which is what a cold open previously had to wait a full
 * composite read to show.
 *
 * Deliberately *only* the row. The page's composite read is around a dozen requests, each of them
 * a hop from this server back through the app's own origin to the API, so prefetching it here
 * would move that whole cost in front of the first byte rather than removing it. The row is one
 * cheap read; the tab panels keep loading on the client, where they can arrive in parallel with
 * the page becoming interactive.
 *
 * A failed prefetch degrades to exactly the previous behavior: nothing is cached, so the client
 * fetches it.
 *
 * @see `docs/engineering/specs/data-layer.md` §7.
 */
import { HydrationBoundary } from '@tanstack/react-query';
import type { JSX } from 'react';

import { unwrap } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';
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
    queryClient.prefetchQuery({
      queryKey: queryKeys.projectRecord(orgId, projectId),
      queryFn: () =>
        unwrap(
          () => api.v1.orgs[':orgId'].projects[':id'].$get({ param: { orgId, id: projectId } }),
          'Could not load this project.',
        ),
    }),
    ...roster,
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProjectDetailClient />
    </HydrationBoundary>
  );
}
