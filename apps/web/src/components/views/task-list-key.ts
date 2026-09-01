import type { TaskOut } from '@docket/work/task-model';

/** Return the stable identity shared by every virtualized task list. */
export function taskListKey(task: Pick<TaskOut, 'id'>): string {
  return task.id;
}
