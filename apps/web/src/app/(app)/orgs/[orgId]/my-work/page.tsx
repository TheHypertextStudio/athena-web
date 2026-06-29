/**
 * The My Work screen — server entry (SSR prefetch + hydration).
 *
 * @remarks
 * Prefetches the five slices {@link useMyWork} composes (tasks, projects, members, agents,
 * sessions) with the caller's session cookie — via the shared {@link myWorkDefs} (so the keys,
 * fetchers, and staleTime tiers match the client exactly) — dehydrates them, and hands the warm
 * cache to {@link MyWorkClient} via `<HydrationBoundary>`, so the screen paints complete on first
 * load (no skeleton, no count jump) then stays live via the client's volatile-tier refetch. Each
 * prefetch is independent (`allSettled`); a failed slice degrades to a client fetch. See
 * `docs/engineering/specs/data-layer.md` §7.
 */
import { HydrationBoundary } from '@tanstack/react-query';
import type { JSX } from 'react';

import { myWorkDefs } from '@/lib/my-work-defs';
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
  const defs = myWorkDefs(orgId, await getServerApi());

  await Promise.allSettled([
    queryClient.prefetchQuery(defs.tasks),
    queryClient.prefetchQuery(defs.projects),
    queryClient.prefetchQuery(defs.members),
    queryClient.prefetchQuery(defs.agents),
    queryClient.prefetchQuery(defs.sessions),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <MyWorkClient />
    </HydrationBoundary>
  );
}
