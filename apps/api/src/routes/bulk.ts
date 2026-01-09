/**
 * Bulk operations routes.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db } from '../db/index.js';
import { tasks, projects, tags, taskTags } from '../db/schema/index.js';
import { eq, inArray, and, or, isNull } from 'drizzle-orm';
import { requireAuth, getUserId } from '../middleware/auth.js';
import {
  parseTodoistExport,
  parseAsanaExport,
  parseTrelloExport,
  type ImportedTask,
} from '../services/importers/index.js';

const app = new Hono();

app.use('*', requireAuth);

const TASK_PRIORITY_VALUES = ['low', 'medium', 'high', 'urgent'] as const;
type TaskPriority = (typeof TASK_PRIORITY_VALUES)[number];
const TASK_STATUS_VALUES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;
type TaskStatus = (typeof TASK_STATUS_VALUES)[number];
const DEFAULT_TASK_PRIORITY: TaskPriority = 'medium';
const DEFAULT_TASK_STATUS: TaskStatus = 'pending';
const IMPORTED_PROJECT_STATUS = 'active' as const;
const BULK_ITEMS_MIN = 1;
const BULK_ITEMS_MAX = 100;
const TASK_IMPORT_FORMAT_VALUES = ['json', 'todoist', 'asana', 'trello'] as const;

/**
 * POST /bulk/tasks
 * Bulk create tasks.
 */
app.post(
  '/tasks',
  zValidator(
    'json',
    z.object({
      tasks: z
        .array(
          z.object({
            title: z.string().min(1).max(500),
            description: z.string().max(10000).optional(),
            projectId: z.uuid().optional(),
            priority: z.enum(TASK_PRIORITY_VALUES).optional(),
            deadline: z.iso.datetime().optional(),
            tags: z.array(z.string()).optional(),
          }),
        )
        .min(BULK_ITEMS_MIN)
        .max(BULK_ITEMS_MAX),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const { tasks: taskData } = c.req.valid('json');

    const now = new Date();
    const createdTasks: string[] = [];

    for (const task of taskData) {
      const id = crypto.randomUUID();

      await db.insert(tasks).values({
        id,
        title: task.title,
        description: task.description ?? null,
        projectId: task.projectId ?? null,
        priority: task.priority ?? DEFAULT_TASK_PRIORITY,
        deadline: task.deadline ? new Date(task.deadline) : null,
        status: DEFAULT_TASK_STATUS,
        creatorId: userId,
        createdAt: now,
        updatedAt: now,
      });

      createdTasks.push(id);
    }

    return c.json({
      success: true,
      data: {
        created: createdTasks.length,
        ids: createdTasks,
      },
    });
  },
);

/**
 * PATCH /bulk/tasks
 * Bulk update tasks.
 */
app.patch(
  '/tasks',
  zValidator(
    'json',
    z.object({
      ids: z.array(z.uuid()).min(BULK_ITEMS_MIN).max(BULK_ITEMS_MAX),
      updates: z.object({
        status: z.enum(TASK_STATUS_VALUES).optional(),
        priority: z.enum(TASK_PRIORITY_VALUES).optional(),
        projectId: z.uuid().nullable().optional(),
        assigneeId: z.uuid().nullable().optional(),
        deadline: z.iso.datetime().nullable().optional(),
      }),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const { ids, updates } = c.req.valid('json');

    // Verify ownership
    const owned = await db.query.tasks.findMany({
      where: and(
        inArray(tasks.id, ids),
        or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId)),
        isNull(tasks.deletedAt),
      ),
      columns: { id: true },
    });

    const ownedIds = owned.map((t) => t.id);

    if (ownedIds.length === 0) {
      return c.json({ success: false, error: 'No tasks found' }, 404);
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (updates.status !== undefined) updateData['status'] = updates.status;
    if (updates.priority !== undefined) updateData['priority'] = updates.priority;
    if (updates.projectId !== undefined) updateData['projectId'] = updates.projectId;
    if (updates.assigneeId !== undefined) updateData['assigneeId'] = updates.assigneeId;
    if (updates.deadline !== undefined) {
      updateData['deadline'] = updates.deadline ? new Date(updates.deadline) : null;
    }

    await db.update(tasks).set(updateData).where(inArray(tasks.id, ownedIds));

    return c.json({
      success: true,
      data: {
        updated: ownedIds.length,
        ids: ownedIds,
      },
    });
  },
);

/**
 * DELETE /bulk/tasks
 * Bulk delete tasks (soft delete).
 */
app.delete(
  '/tasks',
  zValidator(
    'json',
    z.object({
      ids: z.array(z.uuid()).min(BULK_ITEMS_MIN).max(BULK_ITEMS_MAX),
      permanent: z.boolean().optional().default(false),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const { ids, permanent } = c.req.valid('json');

    // Verify ownership
    const owned = await db.query.tasks.findMany({
      where: and(inArray(tasks.id, ids), eq(tasks.creatorId, userId), isNull(tasks.deletedAt)),
      columns: { id: true },
    });

    const ownedIds = owned.map((t) => t.id);

    if (ownedIds.length === 0) {
      return c.json({ success: false, error: 'No tasks found' }, 404);
    }

    if (permanent) {
      await db.delete(tasks).where(inArray(tasks.id, ownedIds));
    } else {
      await db
        .update(tasks)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(inArray(tasks.id, ownedIds));
    }

    return c.json({
      success: true,
      data: {
        deleted: ownedIds.length,
        ids: ownedIds,
      },
    });
  },
);

/**
 * POST /bulk/tasks/tags
 * Bulk add tags to tasks.
 */
app.post(
  '/tasks/tags',
  zValidator(
    'json',
    z.object({
      taskIds: z.array(z.uuid()).min(BULK_ITEMS_MIN).max(BULK_ITEMS_MAX),
      tagIds: z.array(z.uuid()).min(1).max(20),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const { taskIds, tagIds } = c.req.valid('json');

    // Verify task ownership
    const ownedTasks = await db.query.tasks.findMany({
      where: and(
        inArray(tasks.id, taskIds),
        or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId)),
      ),
      columns: { id: true },
    });

    const ownedTaskIds = ownedTasks.map((t) => t.id);

    // Verify tag ownership
    const ownedTags = await db.query.tags.findMany({
      where: and(inArray(tags.id, tagIds), eq(tags.ownerId, userId)),
      columns: { id: true },
    });

    const ownedTagIds = ownedTags.map((t) => t.id);

    // Create associations
    let created = 0;
    for (const taskId of ownedTaskIds) {
      for (const tagId of ownedTagIds) {
        // Check if already exists
        const existing = await db.query.taskTags.findFirst({
          where: and(eq(taskTags.taskId, taskId), eq(taskTags.tagId, tagId)),
        });

        if (!existing) {
          await db.insert(taskTags).values({
            taskId,
            tagId,
          });
          created++;
        }
      }
    }

    return c.json({
      success: true,
      data: { created },
    });
  },
);

/**
 * DELETE /bulk/tasks/tags
 * Bulk remove tags from tasks.
 */
app.delete(
  '/tasks/tags',
  zValidator(
    'json',
    z.object({
      taskIds: z.array(z.uuid()).min(BULK_ITEMS_MIN).max(BULK_ITEMS_MAX),
      tagIds: z.array(z.uuid()).min(1).max(20),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const { taskIds, tagIds } = c.req.valid('json');

    // Verify task ownership
    const ownedTasks = await db.query.tasks.findMany({
      where: and(
        inArray(tasks.id, taskIds),
        or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId)),
      ),
      columns: { id: true },
    });

    const ownedTaskIds = ownedTasks.map((t) => t.id);

    // Delete associations
    let deleted = 0;
    for (const taskId of ownedTaskIds) {
      for (const tagId of tagIds) {
        const existing = await db.query.taskTags.findFirst({
          where: and(eq(taskTags.taskId, taskId), eq(taskTags.tagId, tagId)),
        });

        if (existing) {
          await db
            .delete(taskTags)
            .where(and(eq(taskTags.taskId, taskId), eq(taskTags.tagId, tagId)));
          deleted++;
        }
      }
    }

    return c.json({
      success: true,
      data: { deleted },
    });
  },
);

/**
 * POST /bulk/tasks/move
 * Bulk move tasks to a project.
 */
app.post(
  '/tasks/move',
  zValidator(
    'json',
    z.object({
      taskIds: z.array(z.uuid()).min(BULK_ITEMS_MIN).max(BULK_ITEMS_MAX),
      projectId: z.uuid().nullable(),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const { taskIds, projectId } = c.req.valid('json');

    // Verify task ownership
    const ownedTasks = await db.query.tasks.findMany({
      where: and(
        inArray(tasks.id, taskIds),
        or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId)),
        isNull(tasks.deletedAt),
      ),
      columns: { id: true },
    });

    const ownedTaskIds = ownedTasks.map((t) => t.id);

    // Verify project ownership if provided
    if (projectId) {
      const project = await db.query.projects.findFirst({
        where: and(eq(projects.id, projectId), eq(projects.ownerId, userId)),
      });

      if (!project) {
        return c.json({ success: false, error: 'Project not found' }, 404);
      }
    }

    await db
      .update(tasks)
      .set({ projectId, updatedAt: new Date() })
      .where(inArray(tasks.id, ownedTaskIds));

    return c.json({
      success: true,
      data: {
        moved: ownedTaskIds.length,
        ids: ownedTaskIds,
      },
    });
  },
);

/**
 * POST /bulk/import
 * Import tasks from JSON/CSV.
 */
app.post(
  '/import',
  zValidator(
    'json',
    z.object({
      format: z.enum(TASK_IMPORT_FORMAT_VALUES),
      data: z.unknown(),
      projectId: z.uuid().optional(),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const { format, data, projectId } = c.req.valid('json');

    const now = new Date();
    const importedIds: string[] = [];

    // Parse data based on format
    let importedTasks: ImportedTask[] = [];

    switch (format) {
      case 'json':
        // Simple JSON array import
        if (Array.isArray(data)) {
          const isTaskPriority = (value: string): value is TaskPriority =>
            TASK_PRIORITY_VALUES.includes(value as TaskPriority);
          for (const item of data as {
            title?: string;
            description?: string;
            priority?: string;
            deadline?: string;
          }[]) {
            if (!item.title) continue;
            const priorityValue = typeof item.priority === 'string' ? item.priority : null;
            const normalizedPriority =
              priorityValue && isTaskPriority(priorityValue)
                ? priorityValue
                : DEFAULT_TASK_PRIORITY;
            importedTasks.push({
              title: item.title.slice(0, 500),
              description: item.description?.slice(0, 10000),
              priority: normalizedPriority,
              deadline: item.deadline ? new Date(item.deadline) : undefined,
              status: DEFAULT_TASK_STATUS,
            });
          }
        }
        break;

      case 'todoist':
        importedTasks = parseTodoistExport(data);
        break;

      case 'asana':
        importedTasks = parseAsanaExport(data);
        break;

      case 'trello':
        importedTasks = parseTrelloExport(data);
        break;
    }

    // Import tasks into database
    for (const task of importedTasks) {
      const id = crypto.randomUUID();

      // Determine actual project ID
      let targetProjectId = projectId ?? null;
      if (!targetProjectId && task.projectName) {
        // Try to find or create project by name
        const existingProject = await db.query.projects.findFirst({
          where: and(eq(projects.ownerId, userId), eq(projects.name, task.projectName)),
        });

        if (existingProject) {
          targetProjectId = existingProject.id;
        } else {
          // Create new project
          const newProjectId = crypto.randomUUID();
          await db.insert(projects).values({
            id: newProjectId,
            name: task.projectName,
            ownerId: userId,
            status: IMPORTED_PROJECT_STATUS,
            createdAt: now,
            updatedAt: now,
          });
          targetProjectId = newProjectId;
        }
      }

      await db.insert(tasks).values({
        id,
        title: task.title.slice(0, 500),
        description: task.description?.slice(0, 10000) ?? null,
        projectId: targetProjectId,
        status: task.status ?? DEFAULT_TASK_STATUS,
        priority: task.priority ?? DEFAULT_TASK_PRIORITY,
        deadline: task.deadline ?? null,
        estimatedMinutes: task.estimatedMinutes ?? null,
        creatorId: userId,
        createdAt: now,
        updatedAt: now,
      });

      // Create tags if provided
      if (task.tags && task.tags.length > 0) {
        for (const tagName of task.tags) {
          // Find or create tag
          let tag = await db.query.tags.findFirst({
            where: and(eq(tags.ownerId, userId), eq(tags.name, tagName)),
          });

          if (!tag) {
            const tagId = crypto.randomUUID();
            await db.insert(tags).values({
              id: tagId,
              name: tagName,
              ownerId: userId,
              createdAt: now,
            });
            tag = { id: tagId, name: tagName, ownerId: userId, color: null, createdAt: now };
          }

          // Link tag to task
          await db.insert(taskTags).values({ taskId: id, tagId: tag.id }).onConflictDoNothing();
        }
      }

      importedIds.push(id);
    }

    return c.json({
      success: true,
      data: {
        imported: importedIds.length,
        ids: importedIds,
        format,
      },
    });
  },
);

export default app;
