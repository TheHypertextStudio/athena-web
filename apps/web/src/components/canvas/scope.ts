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
