/**
 * Time block routes.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { eq, and, gte, lte, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { timeBlocks, timeBlockTasks, tasks } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { requireEntitlement } from '../middleware/entitlements.js';

const timeBlockRoutes = new Hono();

// Require authentication for all routes
timeBlockRoutes.use('*', requireAuth);

// Require 'time_tracking' entitlement for mutating operations (POST/PUT/DELETE)
// GET requests pass through (read access is sacred)
timeBlockRoutes.use('*', requireEntitlement('time_tracking'));

const ERROR_TIME_BLOCK_NOT_FOUND = 'Time block not found';
const ERROR_TIME_BLOCK_NOT_AUTHORIZED = 'Time block not found or not authorized';
const ERROR_TASK_NOT_FOUND = 'Task not found';
const ERROR_TASK_ALREADY_LINKED = 'Task already linked to this time block';

/**
 * List all time blocks for the authenticated user.
 * GET /api/time-blocks
 */
timeBlockRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  let whereClause = and(eq(timeBlocks.ownerId, userId), isNull(timeBlocks.deletedAt));

  if (startDate) {
    whereClause = and(whereClause, gte(timeBlocks.startTime, new Date(startDate)));
  }

  if (endDate) {
    whereClause = and(whereClause, lte(timeBlocks.startTime, new Date(endDate)));
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
  const data = result.map((block) => ({
    ...block,
    linkedTasks: block.tasks.map((t) => ({
      ...t.task,
      position: t.position,
    })),
  }));

  return c.json({ data });
});

/**
 * Get a single time block by ID.
 * GET /api/time-blocks/:id
 */
timeBlockRoutes.get('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

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
    return c.json({ error: ERROR_TIME_BLOCK_NOT_FOUND }, 404);
  }

  return c.json({
    data: {
      ...result,
      linkedTasks: result.tasks.map((t) => ({
        ...t.task,
        position: t.position,
      })),
    },
  });
});

/**
 * Create a new time block.
 * POST /api/time-blocks
 */
timeBlockRoutes.post('/', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{
    label: string;
    description?: string;
    startTime: string;
    endTime: string;
    color?: string;
    recurrenceRule?: string;
    taskIds?: string[];
  }>();

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(timeBlocks).values({
    id,
    label: body.label,
    description: body.description,
    startTime: new Date(body.startTime),
    endTime: new Date(body.endTime),
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

  return c.json(
    {
      data: {
        ...result,
        linkedTasks:
          result?.tasks.map((t) => ({
            ...t.task,
            position: t.position,
          })) ?? [],
      },
    },
    201,
  );
});

/**
 * Update a time block.
 * PATCH /api/time-blocks/:id
 */
timeBlockRoutes.patch('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json<{
    label?: string;
    description?: string | null;
    startTime?: string;
    endTime?: string;
    color?: string | null;
    recurrenceRule?: string | null;
  }>();

  const existing = await db.query.timeBlocks.findFirst({
    where: and(eq(timeBlocks.id, id), eq(timeBlocks.ownerId, userId), isNull(timeBlocks.deletedAt)),
  });

  if (!existing) {
    return c.json({ error: ERROR_TIME_BLOCK_NOT_AUTHORIZED }, 404);
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.label !== undefined) updateData.label = body.label;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.startTime !== undefined) updateData.startTime = new Date(body.startTime);
  if (body.endTime !== undefined) updateData.endTime = new Date(body.endTime);
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

  return c.json({
    data: {
      ...result,
      linkedTasks:
        result?.tasks.map((t) => ({
          ...t.task,
          position: t.position,
        })) ?? [],
    },
  });
});

/**
 * Delete a time block (soft delete).
 * DELETE /api/time-blocks/:id
 */
timeBlockRoutes.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const existing = await db.query.timeBlocks.findFirst({
    where: and(eq(timeBlocks.id, id), eq(timeBlocks.ownerId, userId), isNull(timeBlocks.deletedAt)),
  });

  if (!existing) {
    return c.json({ error: ERROR_TIME_BLOCK_NOT_AUTHORIZED }, 404);
  }

  await db.update(timeBlocks).set({ deletedAt: new Date() }).where(eq(timeBlocks.id, id));

  return c.body(null, 204);
});

/**
 * Link a task to a time block.
 * POST /api/time-blocks/:id/tasks
 */
timeBlockRoutes.post('/:id/tasks', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json<{ taskId: string; position?: number }>();

  const timeBlock = await db.query.timeBlocks.findFirst({
    where: and(eq(timeBlocks.id, id), eq(timeBlocks.ownerId, userId), isNull(timeBlocks.deletedAt)),
    with: {
      tasks: true,
    },
  });

  if (!timeBlock) {
    return c.json({ error: ERROR_TIME_BLOCK_NOT_AUTHORIZED }, 404);
  }

  // Verify task exists and belongs to user
  const task = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, body.taskId), eq(tasks.creatorId, userId)),
  });

  if (!task) {
    return c.json({ error: ERROR_TASK_NOT_FOUND }, 404);
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

  return c.json({ success: true }, 201);
});

/**
 * Unlink a task from a time block.
 * DELETE /api/time-blocks/:id/tasks/:taskId
 */
timeBlockRoutes.delete('/:id/tasks/:taskId', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const taskId = c.req.param('taskId');

  const timeBlock = await db.query.timeBlocks.findFirst({
    where: and(eq(timeBlocks.id, id), eq(timeBlocks.ownerId, userId), isNull(timeBlocks.deletedAt)),
  });

  if (!timeBlock) {
    return c.json({ error: ERROR_TIME_BLOCK_NOT_AUTHORIZED }, 404);
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
timeBlockRoutes.put('/:id/tasks/order', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json<{ taskIds: string[] }>();

  const timeBlock = await db.query.timeBlocks.findFirst({
    where: and(eq(timeBlocks.id, id), eq(timeBlocks.ownerId, userId), isNull(timeBlocks.deletedAt)),
  });

  if (!timeBlock) {
    return c.json({ error: ERROR_TIME_BLOCK_NOT_AUTHORIZED }, 404);
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

  return c.json({ success: true });
});

export { timeBlockRoutes };
