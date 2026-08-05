/** Shared per-milestone task-completion counting, used by the Overview summary and Milestones panel. */
import type { TaskOut } from '@docket/types';

import { stateTypeOf } from '@/lib/work-state';

/** A task paired with its resolved milestone id (or `null` when unscheduled). */
export interface MilestoneTaskLike {
  readonly task: TaskOut;
  readonly milestoneId: string | null;
}

/**
 * Count done/total tasks per milestone id, bucketing unscheduled tasks under `unscheduledKey`.
 *
 * @param tasks - The project's tasks, each with its resolved milestone id.
 * @param unscheduledKey - The synthesized bucket id for tasks with no milestone.
 */
export function countTasksByMilestone(
  tasks: readonly MilestoneTaskLike[],
  unscheduledKey: string,
): Map<string, { done: number; total: number }> {
  const buckets = new Map<string, { done: number; total: number }>();
  for (const t of tasks) {
    const key = t.milestoneId ?? unscheduledKey;
    const bucket = buckets.get(key) ?? { done: 0, total: 0 };
    bucket.total += 1;
    if (stateTypeOf(t.task.state) === 'completed') bucket.done += 1;
    buckets.set(key, bucket);
  }
  return buckets;
}
