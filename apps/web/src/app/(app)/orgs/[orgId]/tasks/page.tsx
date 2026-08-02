/**
 * The workspace Tasks roster — server entry (SSR prefetch + hydration).
 *
 * @remarks
 * A React Server Component that prefetches the roster's three slices (tasks, members, projects)
 * with the caller's session cookie, dehydrates them, and hands the warm cache to
 * {@link OrgTasksClient} via `<HydrationBoundary>`. The client's queries read the same keys and
 * hydrate, so the table paints from data on first load instead of a skeleton, while all
 * interactivity (filter/sort/group/create/rename) stays on the client. A failed server prefetch
 * degrades gracefully — nothing is cached for that key, so the client simply fetches it.
 *
 * This route is what makes Tasks a first-class workspace destination rather than something reached
 * by first opening a project or a cycle: `/orgs/:orgId/tasks` is deep-linkable and bookmarkable,
 * and it sits beside `[taskId]/` in the same segment, so the roster and one task's detail are the
 * overview/detail pair of a single destination.
 *
 * @see `docs/engineering/specs/data-layer.md` §7.
 */
import { HydrationBoundary } from '@tanstack/react-query';
import type { JSX } from 'react';

import { unwrap } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';
import { dehydrate, getServerApi, getServerQueryClient } from '@/lib/query-server';

import OrgTasksClient from './org-tasks-client';

/**
 * The workspace Tasks roster page (Server Component).
 *
 * @param props - The route params (the active org id, async in Next 16).
 * @returns the hydrated roster.
 */
export default async function OrgTasksPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): Promise<JSX.Element> {
  const { orgId } = await params;
  const queryClient = getServerQueryClient();
  const api = await getServerApi();

  // Warm the three slices the client reads (under the same keys). `allSettled` so one slow or
  // failed slice never blocks the page — the client just fetches that one on mount.
  await Promise.allSettled([
    queryClient.prefetchQuery({
      queryKey: queryKeys.tasks(orgId),
      queryFn: () =>
        unwrap(
          () => api.v1.orgs[':orgId'].tasks.$get({ param: { orgId }, query: {} }),
          'Could not load tasks.',
        ),
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.members(orgId),
      queryFn: () =>
        unwrap(
          () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
          'Could not load members.',
        ),
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.projects(orgId),
      queryFn: () =>
        unwrap(
          () => api.v1.orgs[':orgId'].projects.$get({ param: { orgId }, query: {} }),
          'Could not load projects.',
        ),
    }),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <OrgTasksClient />
    </HydrationBoundary>
  );
}
