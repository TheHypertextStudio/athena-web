/**
 * The org Projects list — server entry (SSR prefetch + hydration).
 *
 * @remarks
 * A React Server Component that prefetches the roster's three slices (projects, tasks, members)
 * with the caller's session cookie, dehydrates them, and hands the warm cache to
 * {@link ProjectsListClient} via `<HydrationBoundary>`. The client's `useApiListQuery` reads the
 * same query keys and hydrates, so the table paints from data on first load instead of a skeleton,
 * while all interactivity (filter/sort/group/create) stays on the client. A failed server prefetch
 * degrades gracefully — nothing is cached for that key, so the client simply fetches it.
 *
 * @see `docs/engineering/specs/data-layer.md` §7.
 */
import { HydrationBoundary } from '@tanstack/react-query';
import type { JSX } from 'react';

import { unwrap } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';
import { dehydrate, getServerApi, getServerQueryClient } from '@/lib/query-server';

import { ProjectsListClient } from './projects-client';

/**
 * The Projects list page (Server Component).
 *
 * @param props - The route params (the active org id, async in Next 16).
 * @returns the hydrated roster.
 */
export default async function ProjectsListPage({
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
      queryKey: queryKeys.projects(orgId),
      queryFn: () =>
        unwrap(
          () => api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
          'Could not load projects.',
        ),
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.tasks(orgId),
      queryFn: () =>
        unwrap(
          () => api.v1.orgs[':orgId'].tasks.$get({ param: { orgId } }),
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
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProjectsListClient />
    </HydrationBoundary>
  );
}
