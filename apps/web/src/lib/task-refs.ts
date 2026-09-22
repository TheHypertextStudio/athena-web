/** Pure edits to a task's lists of related-task references (subtasks, blockers, links). */
import type { TaskRef } from '@docket/work/task-model';

/**
 * Append `ref` to a list of task references unless it is already there.
 *
 * @param list - The references.
 * @param ref - The reference to add.
 * @returns a new list holding `ref` once.
 */
export function withRef(list: readonly TaskRef[], ref: TaskRef): TaskRef[] {
  return list.some((existing) => existing.id === ref.id) ? [...list] : [...list, ref];
}

/**
 * Drop the reference to `id` from a list of task references.
 *
 * @param list - The references.
 * @param id - The task to drop.
 * @returns a new list without it.
 */
export function withoutRef(list: readonly TaskRef[], id: string): TaskRef[] {
  return list.filter((ref) => ref.id !== id);
}
