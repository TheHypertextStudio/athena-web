/**
 * Time block route serializers.
 *
 * @packageDocumentation
 */

import type { timeBlocks, timeBlockTasks, tasks } from '../../db/schema/index.js';
import { toTask } from '../tasks/serializers.js';

type TimeBlockRow = typeof timeBlocks.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;
type TimeBlockTaskRow = typeof timeBlockTasks.$inferSelect & { task: TaskRow | null };
type TimeBlockWithTasksRow = TimeBlockRow & { tasks: TimeBlockTaskRow[] };

export function toTimeBlock(block: TimeBlockRow) {
  return {
    id: block.id,
    label: block.label,
    description: block.description,
    startTime: block.startTime,
    endTime: block.endTime,
    color: block.color,
    recurrenceRule: block.recurrenceRule,
    ownerId: block.ownerId,
    deletedAt: block.deletedAt ?? null,
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
  };
}

export function toTimeBlockWithTasks(block: TimeBlockWithTasksRow) {
  return {
    ...toTimeBlock(block),
    linkedTasks: block.tasks.flatMap((task) =>
      task.task
        ? [
            {
              ...toTask(task.task),
              position: task.position,
            },
          ]
        : [],
    ),
  };
}
