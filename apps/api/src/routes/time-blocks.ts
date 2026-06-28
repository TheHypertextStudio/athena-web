/**
 * Time block routes.
 *
 * @packageDocumentation
 */

import { createRoute, z } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import { eq, and, gte, lte, isNull } from 'drizzle-orm';
import {
  TimeBlockIdParamSchema,
  TimeBlockTaskParamsSchema,
  ListTimeBlocksQuerySchema,
  CreateTimeBlockRequestSchema,
  UpdateTimeBlockRequestSchema,
  LinkTaskRequestSchema,
  ReorderTasksRequestSchema,
  GenerateTimeBlocksRequestSchema,
  TimeBlockResponseSchema,
  TimeBlockListResponseSchema,
} from '@athena/types/openapi/time-blocks';
import { generateTimeBlocks } from '../services/time-blocks/index.js';
import {
  ErrorResponseSchema,
  NotFoundErrorSchema,
  UnauthorizedErrorSchema,
  ValidationErrorSchema,
} from '@athena/types/openapi/common';
import { db } from '../db/index.js';
import { timeBlocks, timeBlockTasks, tasks } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import { toTimeBlockWithTasks } from './time-blocks/serializers.js';

const timeBlockRoutes = createOpenAPIApp();

// Require authentication for all routes
timeBlockRoutes.use('*', requireAuth);

const ERROR_TIME_BLOCK_NOT_FOUND = 'Time block not found';
const ERROR_TIME_BLOCK_NOT_AUTHORIZED = 'Time block not found or not authorized';
const ERROR_TASK_NOT_FOUND = 'Task not found';
const ERROR_TASK_ALREADY_LINKED = 'Task already linked to this time block';
const NOT_FOUND_ERROR = 'Not found' as const;

// =============================================================================
// List Time Blocks
// =============================================================================

const listTimeBlocks = createRoute({
  method: 'get',
  path: '/',
  tags: ['Time Blocks'],
  summary: 'List time blocks',
  description: 'Retrieve a list of time blocks with optional date filtering and pagination.',
  request: {
    query: ListTimeBlocksQuerySchema,
  },
  responses: {
    200: {
      description: 'Time blocks retrieved successfully',
      content: {
        'application/json': {
          schema: TimeBlockListResponseSchema,
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

// =============================================================================
// Get Time Block
// =============================================================================

const getTimeBlock = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Time Blocks'],
  summary: 'Get a time block',
  description: 'Retrieve a single time block by its ID.',
  request: {
    params: TimeBlockIdParamSchema,
  },
  responses: {
    200: {
      description: 'Time block retrieved successfully',
      content: {
        'application/json': {
          schema: TimeBlockResponseSchema,
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
    404: {
      description: 'Time block not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Create Time Block
// =============================================================================

const createTimeBlock = createRoute({
  method: 'post',
  path: '/',
  tags: ['Time Blocks'],
  summary: 'Create a time block',
  description: 'Create a new time block.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateTimeBlockRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Time block created successfully',
      content: {
        'application/json': {
          schema: TimeBlockResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ValidationErrorSchema,
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

// =============================================================================
// Update Time Block
// =============================================================================

const updateTimeBlock = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Time Blocks'],
  summary: 'Update a time block',
  description: 'Update an existing time block. Only provided fields will be updated.',
  request: {
    params: TimeBlockIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateTimeBlockRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Time block updated successfully',
      content: {
        'application/json': {
          schema: TimeBlockResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ValidationErrorSchema,
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
    404: {
      description: 'Time block not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Time Block
// =============================================================================

const deleteTimeBlock = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Time Blocks'],
  summary: 'Delete a time block',
  description: 'Soft-delete a time block by its ID.',
  request: {
    params: TimeBlockIdParamSchema,
  },
  responses: {
    204: {
      description: 'Time block deleted successfully',
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Time block not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Link Task to Time Block
// =============================================================================

const linkTask = createRoute({
  method: 'post',
  path: '/{id}/tasks',
  tags: ['Time Blocks'],
  summary: 'Link task to time block',
  description: 'Link a task to a time block.',
  request: {
    params: TimeBlockIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: LinkTaskRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Task linked successfully',
      content: {
        'application/json': {
          schema: TimeBlockResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error or task already linked',
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
    404: {
      description: 'Time block or task not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Unlink Task from Time Block
// =============================================================================

const unlinkTask = createRoute({
  method: 'delete',
  path: '/{id}/tasks/{taskId}',
  tags: ['Time Blocks'],
  summary: 'Unlink task from time block',
  description: 'Remove the link between a task and a time block.',
  request: {
    params: TimeBlockTaskParamsSchema,
  },
  responses: {
    204: {
      description: 'Task unlinked successfully',
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Time block or task link not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Reorder Tasks in Time Block
// =============================================================================

const reorderTasks = createRoute({
  method: 'put',
  path: '/{id}/tasks/order',
  tags: ['Time Blocks'],
  summary: 'Reorder tasks in time block',
  description: 'Reorder the tasks linked to a time block.',
  request: {
    params: TimeBlockIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: ReorderTasksRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Tasks reordered successfully',
      content: {
        'application/json': {
          schema: TimeBlockResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error (e.g., task IDs do not match)',
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
    404: {
      description: 'Time block not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Generate Time Blocks
// =============================================================================

const generateRoute = createRoute({
  method: 'post',
  path: '/generate',
  tags: ['Time Blocks'],
  summary: 'Generate time blocks',
  description:
    'Generate AI-suggested time blocks for a date. Returns a streaming SSE response with blocks as they are generated.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: GenerateTimeBlocksRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Streaming response with generated time blocks',
      content: {
        'text/event-stream': {
          schema: z.string(),
        },
      },
    },
    400: {
      description: 'Invalid request',
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

/**
 * List all time blocks for the authenticated user.
 * GET /api/time-blocks
 */
timeBlockRoutes.openapi(listTimeBlocks, async (c) => {
  const userId = getUserId(c);
  const { startDate, endDate } = c.req.valid('query');

  let whereClause = and(eq(timeBlocks.ownerId, userId), isNull(timeBlocks.deletedAt));

  if (startDate) {
    whereClause = and(whereClause, gte(timeBlocks.startTime, startDate));
  }

  if (endDate) {
    whereClause = and(whereClause, lte(timeBlocks.startTime, endDate));
  }

  const result = await db.query.timeBlocks.findMany({
    where: whereClause,
    with: {
      tasks: {
        with: {
          task: true,
        },
        orderBy: (timeBlockTasks, { asc }) => [asc(timeBlockTasks.position)],
      },
    },
    orderBy: (timeBlocks, { asc }) => [asc(timeBlocks.startTime)],
  });

  // Transform to include flattened tasks
  const data = result.map(toTimeBlockWithTasks);

  return c.json({ data }, 200);
});

/**
 * Get a single time block by ID.
 * GET /api/time-blocks/:id
 */
timeBlockRoutes.openapi(getTimeBlock, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const result = await db.query.timeBlocks.findFirst({
    where: and(eq(timeBlocks.id, id), eq(timeBlocks.ownerId, userId), isNull(timeBlocks.deletedAt)),
    with: {
      tasks: {
        with: {
          task: true,
        },
        orderBy: (timeBlockTasks, { asc }) => [asc(timeBlockTasks.position)],
      },
    },
  });

  if (!result) {
    return c.json({ error: NOT_FOUND_ERROR, message: ERROR_TIME_BLOCK_NOT_FOUND }, 404);
  }

  return c.json({ data: toTimeBlockWithTasks(result) }, 200);
});

/**
 * Create a new time block.
 * POST /api/time-blocks
 */
timeBlockRoutes.openapi(createTimeBlock, async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(timeBlocks).values({
    id,
    label: body.label,
    description: body.description,
    startTime: body.startTime,
    endTime: body.endTime,
    color: body.color,
    recurrenceRule: body.recurrenceRule,
    ownerId: userId,
    createdAt: now,
    updatedAt: now,
  });

  // Link tasks if provided
  if (body.taskIds && body.taskIds.length > 0) {
    await db.insert(timeBlockTasks).values(
      body.taskIds.map((taskId, index) => ({
        id: crypto.randomUUID(),
        timeBlockId: id,
        taskId,
        position: index,
        createdAt: now,
      })),
    );
  }

  const result = await db.query.timeBlocks.findFirst({
    where: eq(timeBlocks.id, id),
    with: {
      tasks: {
        with: {
          task: true,
        },
        orderBy: (timeBlockTasks, { asc }) => [asc(timeBlockTasks.position)],
      },
    },
  });

  if (!result) {
    throw new Error('Failed to create time block');
  }

  return c.json({ data: toTimeBlockWithTasks(result) }, 201);
});

/**
 * Update a time block.
 * PATCH /api/time-blocks/:id
 */
timeBlockRoutes.openapi(updateTimeBlock, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const existing = await db.query.timeBlocks.findFirst({
    where: and(eq(timeBlocks.id, id), eq(timeBlocks.ownerId, userId), isNull(timeBlocks.deletedAt)),
  });

  if (!existing) {
    return c.json({ error: NOT_FOUND_ERROR, message: ERROR_TIME_BLOCK_NOT_AUTHORIZED }, 404);
  }

  const updateData: Partial<typeof timeBlocks.$inferInsert> = { updatedAt: new Date() };
  if (body.label !== undefined) updateData.label = body.label;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.startTime !== undefined) updateData.startTime = body.startTime;
  if (body.endTime !== undefined) updateData.endTime = body.endTime;
  if (body.color !== undefined) updateData.color = body.color;
  if (body.recurrenceRule !== undefined) updateData.recurrenceRule = body.recurrenceRule;

  await db.update(timeBlocks).set(updateData).where(eq(timeBlocks.id, id));

  const result = await db.query.timeBlocks.findFirst({
    where: eq(timeBlocks.id, id),
    with: {
      tasks: {
        with: {
          task: true,
        },
        orderBy: (timeBlockTasks, { asc }) => [asc(timeBlockTasks.position)],
      },
    },
  });

  if (!result) {
    throw new Error('Failed to update time block');
  }

  return c.json({ data: toTimeBlockWithTasks(result) }, 200);
});

/**
 * Delete a time block (soft delete).
 * DELETE /api/time-blocks/:id
 */
timeBlockRoutes.openapi(deleteTimeBlock, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const existing = await db.query.timeBlocks.findFirst({
    where: and(eq(timeBlocks.id, id), eq(timeBlocks.ownerId, userId), isNull(timeBlocks.deletedAt)),
  });

  if (!existing) {
    return c.json({ error: NOT_FOUND_ERROR, message: ERROR_TIME_BLOCK_NOT_AUTHORIZED }, 404);
  }

  await db.update(timeBlocks).set({ deletedAt: new Date() }).where(eq(timeBlocks.id, id));

  return c.body(null, 204);
});

/**
 * Link a task to a time block.
 * POST /api/time-blocks/:id/tasks
 */
timeBlockRoutes.openapi(linkTask, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const timeBlock = await db.query.timeBlocks.findFirst({
    where: and(eq(timeBlocks.id, id), eq(timeBlocks.ownerId, userId), isNull(timeBlocks.deletedAt)),
    with: {
      tasks: true,
    },
  });

  if (!timeBlock) {
    return c.json({ error: NOT_FOUND_ERROR, message: ERROR_TIME_BLOCK_NOT_AUTHORIZED }, 404);
  }

  // Verify task exists and belongs to user
  const task = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, body.taskId), eq(tasks.creatorId, userId)),
  });

  if (!task) {
    return c.json({ error: NOT_FOUND_ERROR, message: ERROR_TASK_NOT_FOUND }, 404);
  }

  // Check if already linked
  const existingLink = timeBlock.tasks.find((t) => t.taskId === body.taskId);
  if (existingLink) {
    return c.json({ error: ERROR_TASK_ALREADY_LINKED }, 400);
  }

  const position = body.position ?? timeBlock.tasks.length;

  await db.insert(timeBlockTasks).values({
    id: crypto.randomUUID(),
    timeBlockId: id,
    taskId: body.taskId,
    position,
    createdAt: new Date(),
  });

  const updated = await db.query.timeBlocks.findFirst({
    where: eq(timeBlocks.id, id),
    with: {
      tasks: {
        with: {
          task: true,
        },
        orderBy: (timeBlockTasks, { asc }) => [asc(timeBlockTasks.position)],
      },
    },
  });

  if (!updated) {
    throw new Error('Failed to link task to time block');
  }

  return c.json({ data: toTimeBlockWithTasks(updated) }, 201);
});

/**
 * Unlink a task from a time block.
 * DELETE /api/time-blocks/:id/tasks/:taskId
 */
timeBlockRoutes.openapi(unlinkTask, async (c) => {
  const userId = getUserId(c);
  const { id, taskId } = c.req.valid('param');

  const timeBlock = await db.query.timeBlocks.findFirst({
    where: and(eq(timeBlocks.id, id), eq(timeBlocks.ownerId, userId), isNull(timeBlocks.deletedAt)),
  });

  if (!timeBlock) {
    return c.json({ error: NOT_FOUND_ERROR, message: ERROR_TIME_BLOCK_NOT_AUTHORIZED }, 404);
  }

  await db
    .delete(timeBlockTasks)
    .where(and(eq(timeBlockTasks.timeBlockId, id), eq(timeBlockTasks.taskId, taskId)));

  return c.body(null, 204);
});

/**
 * Reorder tasks within a time block.
 * PUT /api/time-blocks/:id/tasks/order
 */
timeBlockRoutes.openapi(reorderTasks, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const timeBlock = await db.query.timeBlocks.findFirst({
    where: and(eq(timeBlocks.id, id), eq(timeBlocks.ownerId, userId), isNull(timeBlocks.deletedAt)),
  });

  if (!timeBlock) {
    return c.json({ error: NOT_FOUND_ERROR, message: ERROR_TIME_BLOCK_NOT_AUTHORIZED }, 404);
  }

  // Update positions
  for (let i = 0; i < body.taskIds.length; i++) {
    const taskId = body.taskIds[i];
    if (taskId) {
      await db
        .update(timeBlockTasks)
        .set({ position: i })
        .where(and(eq(timeBlockTasks.timeBlockId, id), eq(timeBlockTasks.taskId, taskId)));
    }
  }

  const updated = await db.query.timeBlocks.findFirst({
    where: eq(timeBlocks.id, id),
    with: {
      tasks: {
        with: {
          task: true,
        },
        orderBy: (timeBlockTasks, { asc }) => [asc(timeBlockTasks.position)],
      },
    },
  });

  if (!updated) {
    throw new Error('Failed to reorder time block tasks');
  }

  return c.json({ data: toTimeBlockWithTasks(updated) }, 200);
});

/**
 * Generate AI-suggested time blocks for a date.
 * POST /api/time-blocks/generate
 *
 * Returns an SSE stream with generated blocks.
 * Useful for onboarding, daily planning, or schedule reorganization.
 */
timeBlockRoutes.openapi(generateRoute, (c) => {
  const userId = getUserId(c);
  const { date, intent, calendarEventIds } = c.req.valid('json');

  return streamSSE(c, async (stream) => {
    for await (const chunk of generateTimeBlocks(userId, date, {
      intent: intent ?? undefined,
      calendarEventIds,
    })) {
      if (chunk.type === 'block') {
        await stream.writeSSE({
          event: 'block',
          data: JSON.stringify(chunk.block),
        });
      } else {
        // chunk.type === 'done'
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({ totalBlocks: chunk.totalBlocks }),
        });
      }
    }
  });
});

export { timeBlockRoutes };
