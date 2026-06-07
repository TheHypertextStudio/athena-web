import type { WorkflowStateType } from '@docket/ui/components';

/**
 * Map a task's free-form workflow-state `key` onto its canonical
 * {@link WorkflowStateType}.
 *
 * @remarks
 * A {@link import('@docket/types').TaskOut | TaskOut} carries only the per-team `state`
 * key string, but the design-system `TaskRow`/`StatusIcon` are colored by the canonical
 * *type*. New orgs seed the default workflow (`backlog` → `todo` → `in_progress` → `done`
 * → `canceled`), so this maps those known keys to their type; any unrecognized key
 * (a renamed/custom state) falls back to `backlog`, which is the safe neutral default for
 * a not-yet-started item.
 *
 * @param state - The task's `state` key.
 * @returns the canonical workflow-state type for the status glyph.
 *
 * @example
 * ```ts
 * stateTypeOf('in_progress'); // 'started'
 * ```
 */
export function stateTypeOf(state: string): WorkflowStateType {
  switch (state) {
    case 'todo':
      return 'unstarted';
    case 'in_progress':
      return 'started';
    case 'done':
      return 'completed';
    case 'canceled':
      return 'canceled';
    case 'backlog':
    default:
      return 'backlog';
  }
}

/**
 * The human-readable header label for each canonical {@link WorkflowStateType}.
 *
 * @remarks
 * Used as the sub-group header text when a list is grouped by workflow state (e.g. in the
 * org "My Work" view). These are the canonical, vocabulary-independent state names — the
 * per-team state *labels* may differ, but the type buckets are stable across orgs.
 */
export const STATE_GROUP_LABEL: Record<WorkflowStateType, string> = {
  backlog: 'Backlog',
  unstarted: 'Todo',
  started: 'In Progress',
  completed: 'Done',
  canceled: 'Canceled',
};

/**
 * The canonical workflow-state ordering, from not-started to terminal.
 *
 * @remarks
 * Drives the order state sub-groups appear in (and the within-project task sort) so a list
 * reads top-to-bottom as work progresses: backlog → todo → in progress → done → canceled.
 * The index of a state in this array is its sort rank.
 */
export const STATE_GROUP_ORDER: readonly WorkflowStateType[] = [
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
];
