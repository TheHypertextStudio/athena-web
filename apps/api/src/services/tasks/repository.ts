/**
 * Task repository - database operations for tasks.
 *
 * @packageDocumentation
 */

import { eq, and, or } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { tasks, taskTags, tags, taskDependencies } from '../../db/schema/index.js';
import type { TaskStatus, TaskPriority } from './schemas.js';

export interface TaskRecord {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  deadline: Date | null;
  estimatedMinutes: number | null;
  projectId: string | null;
  assigneeId: string | null;
  creatorId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskWithRelations extends TaskRecord {
  project: { id: string; name: string } | null;
  assignee: { id: string; name: string | null } | null;
  creator: { id: string; name: string | null };
  tags: { tag: { id: string; name: string; color: string | null } }[];
}

export interface TaskListFilters {
  userId: string;
  projectId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  limit: number;
  offset: number;
}

export interface CreateTaskData {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  deadline?: Date;
  estimatedMinutes?: number;
  projectId?: string;
  assigneeId?: string;
  creatorId: string;
}

export interface UpdateTaskData {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  deadline?: Date | null;
  estimatedMinutes?: number | null;
  projectId?: string | null;
  assigneeId?: string | null;
}

const taskWithRelationsQuery = {
  project: {
    columns: { id: true, name: true },
  },
  assignee: {
    columns: { id: true, name: true },
  },
  creator: {
    columns: { id: true, name: true },
  },
  tags: {
    with: {
      tag: {
        columns: { id: true, name: true, color: true },
      },
    },
  },
} as const;

export class TaskRepository {
  async findMany(filters: TaskListFilters): Promise<TaskWithRelations[]> {
    const { userId, projectId, status, priority, limit, offset } = filters;

    let whereClause = or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId));

    if (projectId) {
      whereClause = and(whereClause, eq(tasks.projectId, projectId));
    }
    if (status) {
      whereClause = and(whereClause, eq(tasks.status, status));
    }
    if (priority) {
      whereClause = and(whereClause, eq(tasks.priority, priority));
    }

    const result = await db.query.tasks.findMany({
      where: whereClause,
      with: taskWithRelationsQuery,
      orderBy: (tasks, { desc }) => [desc(tasks.createdAt)],
      limit,
      offset,
    });

    return result as TaskWithRelations[];
  }

  async findById(id: string, userId: string): Promise<TaskWithRelations | null> {
    const result = await db.query.tasks.findFirst({
      where: and(eq(tasks.id, id), or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId))),
      with: {
        ...taskWithRelationsQuery,
        project: {
          columns: { id: true, name: true },
          with: {
            initiative: {
              columns: { id: true, name: true },
            },
          },
        },
      },
    });

    if (!result) {
      return null;
    }
    return result as TaskWithRelations;
  }

  async findByIdAsCreator(id: string, userId: string): Promise<TaskRecord | null> {
    const result = await db.query.tasks.findFirst({
      where: and(eq(tasks.id, id), eq(tasks.creatorId, userId)),
    });

    if (!result) {
      return null;
    }
    return result as TaskRecord;
  }

  async create(data: CreateTaskData): Promise<void> {
    const now = new Date();
    await db.insert(tasks).values({
      ...data,
      createdAt: now,
      updatedAt: now,
    });
  }

  async update(id: string, data: UpdateTaskData): Promise<void> {
    await db
      .update(tasks)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(tasks.id, id));
  }

  async delete(id: string): Promise<void> {
    await db.delete(tasks).where(eq(tasks.id, id));
  }

  async addTags(taskId: string, tagIds: string[]): Promise<void> {
    if (tagIds.length === 0) return;
    await db.insert(taskTags).values(tagIds.map((tagId) => ({ taskId, tagId })));
  }

  async replaceTags(taskId: string, tagIds: string[]): Promise<void> {
    await db.delete(taskTags).where(eq(taskTags.taskId, taskId));
    if (tagIds.length > 0) {
      await db.insert(taskTags).values(tagIds.map((tagId) => ({ taskId, tagId })));
    }
  }

  async addTag(taskId: string, tagId: string): Promise<void> {
    await db.insert(taskTags).values({ taskId, tagId }).onConflictDoNothing();
  }

  async removeTag(taskId: string, tagId: string): Promise<void> {
    await db.delete(taskTags).where(and(eq(taskTags.taskId, taskId), eq(taskTags.tagId, tagId)));
  }

  async findTagByOwner(tagId: string, ownerId: string): Promise<{ id: string } | null> {
    const result = await db.query.tags.findFirst({
      where: and(eq(tags.id, tagId), eq(tags.ownerId, ownerId)),
      columns: { id: true },
    });
    return result ?? null;
  }

  async findDependencies(taskId: string): Promise<TaskRecord[]> {
    const dependencies = await db.query.taskDependencies.findMany({
      where: eq(taskDependencies.taskId, taskId),
      with: {
        dependsOnTask: true,
      },
    });
    return dependencies.map((d) => d.dependsOnTask as TaskRecord);
  }

  async hasDependency(taskId: string, dependsOnId: string): Promise<boolean> {
    const result = await db.query.taskDependencies.findFirst({
      where: and(
        eq(taskDependencies.taskId, taskId),
        eq(taskDependencies.dependsOnTaskId, dependsOnId),
      ),
    });
    return result != null;
  }

  async addDependency(id: string, taskId: string, dependsOnId: string): Promise<void> {
    await db
      .insert(taskDependencies)
      .values({
        id,
        taskId,
        dependsOnTaskId: dependsOnId,
        createdAt: new Date(),
      })
      .onConflictDoNothing();
  }

  async removeDependency(taskId: string, dependsOnId: string): Promise<void> {
    await db
      .delete(taskDependencies)
      .where(
        and(eq(taskDependencies.taskId, taskId), eq(taskDependencies.dependsOnTaskId, dependsOnId)),
      );
  }
}
