/**
 * `components/canvas/scope` — the dependency-graph scope + its cache-key serializer.
 *
 * @remarks
 * Server-safe (no `'use client'`): both the client feeder hook and the server prefetch in the
 * focused-view page import these, so they MUST agree on the key or SSR hydration misses. Keeping
 * them here (rather than in the client `use-task-graph` module) avoids a "client function called
 * from the server" error when the server component derives the prefetch key.
 */

/** The scope a canvas embed renders. Exactly one of project/root narrows the org graph. */
export interface TaskGraphScope {
  /** The organization whose graph to read. */
  orgId: string;
  /** Narrow to one project's tasks. */
  projectId?: string;
  /** Center on one task's connected neighborhood. */
  rootTaskId?: string;
  /** Neighborhood radius when `rootTaskId` is set (default 2 on the server). */
  depth?: number;
}

/**
 * Serialize the scope into the cache-key discriminator (`task:…` / `project:…` / `org`).
 *
 * @param scope - The graph scope.
 * @returns the stable key segment shared by the client read and the server prefetch.
 */
export function taskGraphScopeKey(scope: TaskGraphScope): string {
  if (scope.rootTaskId !== undefined) return `task:${scope.rootTaskId}:${scope.depth ?? 2}`;
  if (scope.projectId !== undefined) return `project:${scope.projectId}`;
  return 'org';
}

/** The query-string values the graph scope is narrowed by. */
export interface TaskGraphSearch {
  /** Narrow to one project's tasks. */
  projectId?: string | undefined;
  /** Centre on one task's connected neighbourhood. */
  rootTaskId?: string | undefined;
  /** Neighbourhood radius, as it appears in the URL. */
  depth?: string | undefined;
}

/**
 * Build the scope from a workspace id and the query string.
 *
 * @remarks
 * Shared by the server prefetch and the client entry point, which must agree: the server warms the
 * graph under `taskGraphScopeKey(scope)` and the client reads the same key. They used to derive the
 * scope separately, and offline there is no server render at all — the client entry resolves it from
 * the URL alone — so a second copy of this would be a cache miss waiting to happen.
 *
 * @param orgId - The workspace whose graph is being read.
 * @param search - The query string values.
 * @returns The scope.
 */
export function resolveTaskGraphScope(orgId: string, search: TaskGraphSearch): TaskGraphScope {
  const depth = search.depth !== undefined ? Number(search.depth) : undefined;
  return {
    orgId,
    ...(search.projectId !== undefined ? { projectId: search.projectId } : {}),
    ...(search.rootTaskId !== undefined ? { rootTaskId: search.rootTaskId } : {}),
    ...(depth !== undefined && Number.isFinite(depth) ? { depth } : {}),
  };
}
