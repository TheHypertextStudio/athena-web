import type { TaskOut } from '@docket/types';

/** Return the stable identity shared by every virtualized task list. */
export function taskListKey(task: Pick<TaskOut, 'id'>): string {
  return task.id;
}
