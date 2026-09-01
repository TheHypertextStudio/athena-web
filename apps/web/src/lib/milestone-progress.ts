/** Shared per-milestone task-completion counting, used by the Overview summary and Milestones panel. */
import type { TaskOut } from '@docket/work/task-model';

import type { CategoryOfState } from '@/lib/work-category';

/** A task paired with its resolved milestone id (or `null` when unscheduled). */
export interface MilestoneTaskLike {
  readonly task: TaskOut;
  readonly milestoneId: string | null;
}

/**
 * Count done/total tasks per milestone id, bucketing unscheduled tasks under `unscheduledKey`.
 *
 * @remarks
 * "Done" is the `completed` category, so a workspace that ships work under a status called
 * `Shipped` sees its milestone bar fill. The caller resolves the category because the workspace's
 * status set lives in React context and this stays a pure count.
 *
 * @param tasks - The project's tasks, each with its resolved milestone id.
 * @param unscheduledKey - The synthesized bucket id for tasks with no milestone.
 * @param categoryOf - Resolves a task's status key to its category.
 * @returns done/total per milestone id.
 */
export function countTasksByMilestone(
  tasks: readonly MilestoneTaskLike[],
  unscheduledKey: string,
  categoryOf: CategoryOfState,
): Map<string, { done: number; total: number }> {
  const buckets = new Map<string, { done: number; total: number }>();
  for (const t of tasks) {
    const key = t.milestoneId ?? unscheduledKey;
    const bucket = buckets.get(key) ?? { done: 0, total: 0 };
    bucket.total += 1;
    if (categoryOf(t.task.state) === 'completed') bucket.done += 1;
    buckets.set(key, bucket);
  }
  return buckets;
}
