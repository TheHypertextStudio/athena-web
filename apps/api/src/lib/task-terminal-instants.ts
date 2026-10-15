import type { TaskStatusTransition } from './work-status';

/** Keep the actual terminal instant when an ordinary request repeats the current workflow status. */
export function preserveTaskTerminalInstants(
  before: Readonly<Record<string, unknown>>,
  transition: TaskStatusTransition,
): TaskStatusTransition {
  if (before['statusId'] !== transition.statusId) return transition;
  return {
    ...transition,
    completedAt:
      transition.completedAt && before['completedAt'] instanceof Date
        ? before['completedAt']
        : transition.completedAt,
    canceledAt:
      transition.canceledAt && before['canceledAt'] instanceof Date
        ? before['canceledAt']
        : transition.canceledAt,
  };
}
/** Whether an accepted write left workflow state and its actual terminal instants unchanged. */
export function sameTaskTerminalState(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): boolean {
  return ['statusId', 'completedAt', 'canceledAt'].every((field) => {
    const value = (row: Readonly<Record<string, unknown>>) =>
      row[field] instanceof Date ? row[field].toISOString() : row[field];
    return value(before) === value(after);
  });
}
