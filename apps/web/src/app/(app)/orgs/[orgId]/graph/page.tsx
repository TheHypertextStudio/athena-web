/**
 * The dependency-graph focused view — server entry (SSR prefetch + hydration).
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
import type { JSX } from 'react';

import { type TaskGraphScope, taskGraphScopeKey } from '@/components/canvas/scope';
import { unwrap } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';
import { dehydrate, getServerApi, getServerQueryClient } from '@/lib/query-server';

import GraphClient from './graph-client';

/** Build the scope (and the endpoint query) from the route params + search params. */
function resolveScope(
  orgId: string,
  search: { projectId?: string; rootTaskId?: string; depth?: string },
): { scope: TaskGraphScope; query: Record<string, string> } {
  const depth = search.depth !== undefined ? Number(search.depth) : undefined;
  const scope: TaskGraphScope = {
    orgId,
    ...(search.projectId !== undefined ? { projectId: search.projectId } : {}),
    ...(search.rootTaskId !== undefined ? { rootTaskId: search.rootTaskId } : {}),
    ...(depth !== undefined && Number.isFinite(depth) ? { depth } : {}),
  };
  const query: Record<string, string> = {};
  if (scope.projectId !== undefined) query['projectId'] = scope.projectId;
  if (scope.rootTaskId !== undefined) query['rootTaskId'] = scope.rootTaskId;
  if (scope.depth !== undefined) query['depth'] = String(scope.depth);
  return { scope, query };
}

/**
 * The dependency-graph page (Server Component).
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
  const search = await searchParams;
  const { scope, query } = resolveScope(orgId, search);

  const queryClient = getServerQueryClient();
  const api = await getServerApi();

  await queryClient.prefetchQuery({
    queryKey: queryKeys.taskGraph(orgId, taskGraphScopeKey(scope)),
    queryFn: () =>
      unwrap(
        () => api.v1.orgs[':orgId'].graph.$get({ param: { orgId }, query }),
        'Could not load the dependency graph.',
      ),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <GraphClient scope={scope} />
    </HydrationBoundary>
  );
}
