/**
 * Tag route serializers.
 *
 * @packageDocumentation
 */

import type { tags, taskTags, tasks } from '../../db/schema/index.js';

type TagRow = typeof tags.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;
type TagTaskRow = typeof taskTags.$inferSelect & { task: TaskRow | null };
type TagWithTasksRow = TagRow & { tasks?: TagTaskRow[] };

export function toTagWithTasks(tag: TagWithTasksRow) {
  const tasks = tag.tasks ?? [];
  return {
    id: tag.id,
    name: tag.name,
    color: tag.color,
    ownerId: tag.ownerId,
    createdAt: tag.createdAt,
    tasks: tasks.map((tagTask) => ({
      task: tagTask.task
        ? {
            id: tagTask.task.id,
            title: tagTask.task.title,
            status: tagTask.task.status,
          }
        : null,
    })),
  };
}
