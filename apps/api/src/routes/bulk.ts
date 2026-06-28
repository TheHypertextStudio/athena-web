/**
 * Bulk operations routes.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  BulkCreateTasksRequestSchema,
  BulkUpdateTasksRequestSchema,
  BulkDeleteTasksRequestSchema,
  BulkAddTagsRequestSchema,
  BulkRemoveTagsRequestSchema,
  BulkMoveTasksRequestSchema,
  ImportTasksRequestSchema,
  BulkCreateResponseSchema,
  BulkUpdateResponseSchema,
  BulkDeleteResponseSchema,
  BulkTagsResponseSchema,
  BulkMoveResponseSchema,
  ImportResponseSchema,
} from '@athena/types/openapi/bulk';
import { ErrorResponseSchema, UnauthorizedErrorSchema } from '@athena/types/openapi/common';
import { db } from '../db/index.js';
import { tasks, projects, tags, taskTags } from '../db/schema/index.js';
import { eq, inArray, and, or, isNull } from 'drizzle-orm';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import {
  parseTodoistExport,
  parseAsanaExport,
  parseTrelloExport,
  type ImportedTask,
} from '../services/importers/index.js';
import {
  DEFAULT_TASK_PRIORITY,
  DEFAULT_TASK_STATUS,
  ERROR_NO_TASKS_FOUND,
  ERROR_PROJECT_NOT_FOUND,
  IMPORTED_PROJECT_STATUS,
  isTaskPriority,
} from './bulk/helpers.js';

const app = createOpenAPIApp();

app.use('*', requireAuth);


// =============================================================================
// OpenAPI Route Definitions
// =============================================================================

const bulkCreateTasks = createRoute({
  method: 'post',
  path: '/tasks',
  tags: ['Bulk'],
  summary: 'Bulk create tasks',
  description: 'Create multiple tasks in a single request.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: BulkCreateTasksRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Tasks created successfully',
      content: {
        'application/json': {
          schema: BulkCreateResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

const bulkUpdateTasks = createRoute({
  method: 'patch',
  path: '/tasks',
  tags: ['Bulk'],
  summary: 'Bulk update tasks',
  description: 'Update multiple tasks in a single request.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: BulkUpdateTasksRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Tasks updated successfully',
      content: {
        'application/json': {
          schema: BulkUpdateResponseSchema,
        },
      },
    },
    404: {
      description: 'No tasks found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

const bulkDeleteTasks = createRoute({
  method: 'delete',
  path: '/tasks',
  tags: ['Bulk'],
  summary: 'Bulk delete tasks',
  description: 'Delete multiple tasks in a single request.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: BulkDeleteTasksRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Tasks deleted successfully',
      content: {
        'application/json': {
          schema: BulkDeleteResponseSchema,
        },
      },
    },
    404: {
      description: 'No tasks found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

const bulkAddTags = createRoute({
  method: 'post',
  path: '/tasks/tags',
  tags: ['Bulk'],
  summary: 'Bulk add tags',
  description: 'Add tags to multiple tasks.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: BulkAddTagsRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Tags added successfully',
      content: {
        'application/json': {
          schema: BulkTagsResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

const bulkRemoveTags = createRoute({
  method: 'delete',
  path: '/tasks/tags',
  tags: ['Bulk'],
  summary: 'Bulk remove tags',
  description: 'Remove tags from multiple tasks.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: BulkRemoveTagsRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Tags removed successfully',
      content: {
        'application/json': {
          schema: BulkTagsResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

const bulkMoveTasks = createRoute({
  method: 'post',
  path: '/tasks/move',
  tags: ['Bulk'],
  summary: 'Bulk move tasks',
  description: 'Move multiple tasks to another project.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: BulkMoveTasksRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Tasks moved successfully',
      content: {
        'application/json': {
          schema: BulkMoveResponseSchema,
        },
      },
    },
    404: {
      description: 'Project not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

const importTasks = createRoute({
  method: 'post',
  path: '/import',
  tags: ['Bulk'],
  summary: 'Import tasks',
  description: 'Import tasks from external services.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: ImportTasksRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Tasks imported successfully',
      content: {
        'application/json': {
          schema: ImportResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});
/**
 * POST /bulk/tasks
 * Bulk create tasks.
 */
app.openapi(bulkCreateTasks, async (c) => {
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
      deadline: task.deadline ?? null,
      status: DEFAULT_TASK_STATUS,
      creatorId: userId,
      createdAt: now,
      updatedAt: now,
    });

    createdTasks.push(id);
  }

  return c.json({
    data: {
      created: createdTasks.length,
      ids: createdTasks,
    },
  }, 200);
});

/**
 * PATCH /bulk/tasks
 * Bulk update tasks.
 */
app.openapi(bulkUpdateTasks, async (c) => {
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
    return c.json({ error: ERROR_NO_TASKS_FOUND }, 404);
  }

  const updateData: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };

  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.priority !== undefined) updateData.priority = updates.priority;
  if (updates.projectId !== undefined) updateData.projectId = updates.projectId;
  if (updates.assigneeId !== undefined) updateData.assigneeId = updates.assigneeId;
  if (updates.deadline !== undefined) {
    updateData.deadline = updates.deadline ?? null;
  }

  await db.update(tasks).set(updateData).where(inArray(tasks.id, ownedIds));

  return c.json({
    data: {
      updated: ownedIds.length,
      ids: ownedIds,
    },
  }, 200);
});

/**
 * DELETE /bulk/tasks
 * Bulk delete tasks (soft delete).
 */
app.openapi(bulkDeleteTasks, async (c) => {
  const userId = getUserId(c);
  const { ids, permanent } = c.req.valid('json');

  // Verify ownership
  const owned = await db.query.tasks.findMany({
    where: and(inArray(tasks.id, ids), eq(tasks.creatorId, userId), isNull(tasks.deletedAt)),
    columns: { id: true },
  });

  const ownedIds = owned.map((t) => t.id);

  if (ownedIds.length === 0) {
    return c.json({ error: ERROR_NO_TASKS_FOUND }, 404);
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
    data: {
      deleted: ownedIds.length,
      ids: ownedIds,
    },
  }, 200);
});

/**
 * POST /bulk/tasks/tags
 * Bulk add tags to tasks.
 */
app.openapi(bulkAddTags, async (c) => {
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
    data: { created },
  }, 200);
});

/**
 * DELETE /bulk/tasks/tags
 * Bulk remove tags from tasks.
 */
app.openapi(bulkRemoveTags, async (c) => {
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
    data: { deleted },
  }, 200);
});

/**
 * POST /bulk/tasks/move
 * Bulk move tasks to a project.
 */
app.openapi(bulkMoveTasks, async (c) => {
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
      return c.json({ error: ERROR_PROJECT_NOT_FOUND }, 404);
    }
  }

  await db
    .update(tasks)
    .set({ projectId, updatedAt: new Date() })
    .where(inArray(tasks.id, ownedTaskIds));

  return c.json({
    data: {
      moved: ownedTaskIds.length,
      ids: ownedTaskIds,
    },
  }, 200);
});

/**
 * POST /bulk/import
 * Import tasks from JSON/CSV.
 */
app.openapi(importTasks, async (c) => {
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
    data: {
      imported: importedIds.length,
      ids: importedIds,
      format,
    },
  }, 200);
});

export default app;
