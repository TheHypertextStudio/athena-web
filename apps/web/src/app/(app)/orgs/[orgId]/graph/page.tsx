/**
 * The Task graph focused view — server entry (SSR prefetch + hydration).
 *
 * @remarks
 * The expand target for every canvas embed and the global "Graph" workspace destination. The
 * scope comes from the query string (`?projectId=` / `?rootTaskId=&depth=`), so an embed expands
 * by navigating here with its scope preserved. The server warms the graph under the same scoped
 * key {@link GraphClient} reads, so the canvas paints from data on first load. A failed prefetch
 * degrades gracefully — the client just fetches on mount.
 *
 * @see `docs/engineering/specs/data-layer.md` §7.
 */
import { HydrationBoundary } from '@tanstack/react-query';
import { type JSX, Suspense } from 'react';

import {
  resolveTaskGraphScope,
  type TaskGraphScope,
  taskGraphScopeKey,
} from '@/components/canvas/scope';
import { unwrap } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';
import { dehydrate, getServerApi, getServerQueryClient } from '@/lib/query-server';

import GraphClient from './graph-client';

/** The endpoint query string for a scope. */
function endpointQuery(scope: TaskGraphScope): Record<string, string> {
  const query: Record<string, string> = {};
  if (scope.projectId !== undefined) query['projectId'] = scope.projectId;
  if (scope.rootTaskId !== undefined) query['rootTaskId'] = scope.rootTaskId;
  if (scope.depth !== undefined) query['depth'] = String(scope.depth);
  return query;
}

/**
 * The Task graph page (Server Component).
 *
 * @param props - The route params + search params (async in Next 16).
 * @returns the hydrated focused canvas.
 */
export default async function GraphPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ projectId?: string; rootTaskId?: string; depth?: string }>;
}): Promise<JSX.Element> {
  const { orgId } = await params;
  const scope = resolveTaskGraphScope(orgId, await searchParams);

  const queryClient = getServerQueryClient();
  const api = await getServerApi();

  await queryClient.prefetchQuery({
    queryKey: queryKeys.taskGraph(orgId, taskGraphScopeKey(scope)),
    queryFn: () =>
      unwrap(
        () => api.v1.orgs[':orgId'].graph.$get({ param: { orgId }, query: endpointQuery(scope) }),
        'Could not load the task graph.',
      ),
  });

  // The client resolves the same scope from the same URL through `resolveTaskGraphScope`, so it
  // reads exactly the key this warmed.
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {/*
        `GraphCanvas` reads the filter/presentation state out of `useSearchParams`, which opts an
        un-suspended page out of prerendering entirely: the shell is server-rendered while the page
        is not, and the two trees then disagree about React's generated ids — which surfaces as a
        hydration mismatch on an unrelated element such as the sidebar's account menu. A boundary
        here scopes the client-only part to the canvas, which is what it always was.
      */}
      <Suspense fallback={null}>
        <GraphClient />
      </Suspense>
    </HydrationBoundary>
  );
}
