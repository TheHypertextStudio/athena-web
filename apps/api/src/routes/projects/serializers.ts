/**
 * Project route serializers.
 *
 * @packageDocumentation
 */

import type { initiatives, projects, tasks, users } from '../../db/schema/index.js';
import type { InitiativeStatus } from '@athena/types/openapi/initiatives';
import { toTask } from '../tasks/serializers.js';

type ProjectRow = typeof projects.$inferSelect;
type InitiativeRow = typeof initiatives.$inferSelect;
type UserRow = typeof users.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;

type ProjectTaskRow = TaskRow & {
  project?: { id: string; name: string } | null;
  assignee?: { id: string; name: string | null } | null;
  creator?: { id: string; name: string | null } | null;
  tags?: { tag: { id: string; name: string; color: string | null } }[];
};

type ProjectWithRelationsRow = ProjectRow & {
  initiative?: InitiativeRow | null;
  owner?: UserRow | null;
  taskCount?: number | null;
  tasks?: ProjectTaskRow[];
};

type ProjectTaskResponse = ReturnType<typeof toTask> & {
  project?: { id: string; name: string } | null;
  assignee?: { id: string; name: string | null } | null;
  creator?: { id: string; name: string | null };
  tags?: { tag: { id: string; name: string; color: string | null } }[];
};

type ProjectResponse = ReturnType<typeof toProject> & {
  initiative?: { id: string; name: string; status: InitiativeStatus } | null;
  owner?: { id: string; name: string | null };
  taskCount?: number;
  tasks?: ProjectTaskResponse[];
};

export function toProject(project: ProjectRow) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    deadline: project.deadline ?? null,
    initiativeId: project.initiativeId,
    ownerId: project.ownerId,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export function toProjectTask(task: ProjectTaskRow) {
  const base = toTask(task);
  const response: ProjectTaskResponse = { ...base };

  if (task.project !== undefined) {
    response.project = task.project ? { id: task.project.id, name: task.project.name } : null;
  }

  if (task.assignee !== undefined) {
    response.assignee = task.assignee
      ? {
          id: task.assignee.id,
          name: task.assignee.name,
        }
      : null;
  }

  if (task.creator) {
    response.creator = {
      id: task.creator.id,
      name: task.creator.name,
    };
  }

  if (task.tags !== undefined) {
    response.tags = task.tags.map((tag) => ({
      tag: {
        id: tag.tag.id,
        name: tag.tag.name,
        color: tag.tag.color,
      },
    }));
  }

  return response;
}

export function toDependencyGraphTask(
  task: ProjectTaskRow & { assignee?: { email?: string | null } | null },
) {
  const response: ProjectTaskResponse & {
    assignee?: { id: string; name: string | null; email?: string | null } | null;
  } = toProjectTask(task);

  if (response.assignee && task.assignee && 'email' in task.assignee) {
    response.assignee = { ...response.assignee, email: task.assignee.email ?? null };
  }

  return response;
}

export function toProjectWithRelations(project: ProjectWithRelationsRow) {
  const response: ProjectResponse = {
    ...toProject(project),
  };

  if ('initiative' in project) {
    response.initiative = project.initiative
      ? {
          id: project.initiative.id,
          name: project.initiative.name,
          status: project.initiative.status,
        }
      : null;
  }

  if ('owner' in project && project.owner) {
    response.owner = {
      id: project.owner.id,
      name: project.owner.name,
    };
  }

  if ('taskCount' in project && project.taskCount !== null && project.taskCount !== undefined) {
    response.taskCount = project.taskCount;
  }

  if ('tasks' in project && project.tasks) {
    response.tasks = project.tasks.map(toProjectTask);
  }

  return response;
}
