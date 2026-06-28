/**
 * Time tracking route serializers.
 *
 * @packageDocumentation
 */

import type { tasks, timeEntries } from '../../db/schema/index.js';

type TaskRow = typeof tasks.$inferSelect;
type TimeEntryRow = typeof timeEntries.$inferSelect;
type TimeEntryWithTaskRow = TimeEntryRow & { task: TaskRow | null };

export function toTimeEntryTask(task: TaskRow | null) {
  return task
    ? {
        id: task.id,
        title: task.title,
        status: task.status,
      }
    : null;
}

export function toTimeEntry(entry: TimeEntryWithTaskRow) {
  return {
    id: entry.id,
    taskId: entry.taskId,
    userId: entry.userId,
    startTime: entry.startTime,
    endTime: entry.endTime ?? null,
    description: entry.description,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    task: toTimeEntryTask(entry.task),
  };
}
