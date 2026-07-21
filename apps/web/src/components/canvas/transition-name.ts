/**
 * `components/canvas/transition-name` — the stable per-task `view-transition-name`.
 *
 * @remarks
 * A task node uses the same name wherever it appears (a compact embed, the focused full
 * view), so wrapping a navigation/filter state change in `startViewTransition` lets the
 * browser morph the shared node between arrangements instead of hard-swapping. Mirrors the
 * agenda's `agendaEntryTransitionName` convention.
 */

/** The `view-transition-name` for a task node, stable across every canvas surface. */
export function taskNodeTransitionName(taskId: string): string {
  return `task-node-${taskId}`;
}

/** The `view-transition-name` for a project node, stable across every canvas surface. */
export function projectNodeTransitionName(projectId: string): string {
  return `project-node-${projectId}`;
}
