/**
 * Task route serializers.
 *
 * @packageDocumentation
 */

import type { TaskRecord, TaskWithRelations } from '../../services/tasks/repository.js';

type TaskWithRelationsInput = Omit<
  TaskWithRelations,
  'project' | 'assignee' | 'creator' | 'tags'
> & {
  project?: TaskWithRelations['project'] | null;
  assignee?: TaskWithRelations['assignee'] | null;
  creator?: TaskWithRelations['creator'];
  tags?: TaskWithRelations['tags'];
};

export function toTask(task: TaskRecord) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    deadline: task.deadline ?? null,
    estimatedMinutes: task.estimatedMinutes,
    projectId: task.projectId,
    assigneeId: task.assigneeId,
    creatorId: task.creatorId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export function toTaskWithRelations(task: TaskWithRelationsInput) {
  return {
    ...toTask(task),
    project: task.project ? { id: task.project.id, name: task.project.name } : null,
    assignee: task.assignee ? { id: task.assignee.id, name: task.assignee.name } : null,
    creator: task.creator ? { id: task.creator.id, name: task.creator.name } : undefined,
    tags: task.tags
      ? task.tags.map((tag) => ({
          tag: {
            id: tag.tag.id,
            name: tag.tag.name,
            color: tag.tag.color,
          },
        }))
      : undefined,
  };
}
