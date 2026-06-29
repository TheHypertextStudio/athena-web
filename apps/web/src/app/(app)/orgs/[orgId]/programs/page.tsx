/**
 * The org Programs list — server entry (SSR prefetch + hydration).
 *
 * @remarks
 * Prefetches the roster's slices (programs, projects, tasks, members) with the caller's session
 * cookie, dehydrates them, and hands the warm cache to {@link ProgramsListClient} via
 * `<HydrationBoundary>` — so the table paints from data on first load, not a skeleton. A failed
 * prefetch degrades gracefully (the client fetches that slice). See `docs/engineering/specs/data-layer.md` §7.
 */
import { HydrationBoundary } from '@tanstack/react-query';
import type { JSX } from 'react';

import { unwrap } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';
import { dehydrate, getServerApi, getServerQueryClient } from '@/lib/query-server';

import ProgramsListClient from './programs-client';

/**
 * The Programs list page (Server Component).
 *
 * @param props - The route params (the active org id, async in Next 16).
 * @returns the hydrated roster.
 */
export default async function ProgramsListPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): Promise<JSX.Element> {
  const { orgId } = await params;
  const queryClient = getServerQueryClient();
  const api = await getServerApi();

  await Promise.allSettled([
    queryClient.prefetchQuery({
      queryKey: queryKeys.programs(orgId),
      queryFn: () =>
        unwrap(
          () => api.v1.orgs[':orgId'].programs.$get({ param: { orgId } }),
          'Could not load programs.',
        ),
    }),
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
      <ProgramsListClient />
    </HydrationBoundary>
  );
}
