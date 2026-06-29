/**
 * The My Work screen — server entry (SSR prefetch + hydration).
 *
 * @remarks
 * Prefetches the five slices {@link useMyWork} composes (tasks, projects, members, agents,
 * sessions) with the caller's session cookie, under their canonical {@link queryKeys}, dehydrates
 * them, and hands the warm cache to {@link MyWorkClient} via `<HydrationBoundary>` — so the screen
 * paints complete on first load (no skeleton, no count jump) then stays live via the client's
 * volatile-tier refetch. Each prefetch is independent (`allSettled`); a failed slice degrades to a
 * client fetch. See `docs/engineering/specs/data-layer.md` §7.
 */
import { HydrationBoundary } from '@tanstack/react-query';
import type { JSX } from 'react';

import { unwrap } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';
import { dehydrate, getServerApi, getServerQueryClient } from '@/lib/query-server';

import MyWorkClient from './my-work-client';

/**
 * The My Work page (Server Component).
 *
 * @param props - The route params (the active org id, async in Next 16).
 * @returns the hydrated screen.
 */
export default async function MyWorkPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): Promise<JSX.Element> {
  const { orgId } = await params;
  const queryClient = getServerQueryClient();
  const api = await getServerApi();

  await Promise.allSettled([
    queryClient.prefetchQuery({
      queryKey: queryKeys.tasks(orgId),
      queryFn: () =>
        unwrap(
          () => api.v1.orgs[':orgId'].tasks.$get({ param: { orgId } }),
          'Could not load your work.',
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
      queryKey: queryKeys.members(orgId),
      queryFn: () =>
        unwrap(
          () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
          'Could not load members.',
        ),
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.agents(orgId),
      queryFn: () =>
        unwrap(
          () => api.v1.orgs[':orgId'].agents.$get({ param: { orgId } }),
          'Could not load agents.',
        ),
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.sessions(orgId),
      queryFn: () =>
        unwrap(
          () => api.v1.orgs[':orgId'].sessions.$get({ param: { orgId }, query: {} }),
          'Could not load agent sessions.',
        ),
    }),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <MyWorkClient />
    </HydrationBoundary>
  );
}
