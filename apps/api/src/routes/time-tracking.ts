/**
 * Time tracking routes.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { eq, and, isNull, gte, lte } from 'drizzle-orm';
import { db } from '../db/index.js';
import { timeEntries, tasks } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { requireEntitlement } from '../middleware/entitlements.js';

const timeTrackingRoutes = new Hono();

// Require authentication for all routes
timeTrackingRoutes.use('*', requireAuth);

// Require 'time_tracking' entitlement for mutating operations (POST/PUT/DELETE)
// GET requests pass through (read access is sacred)
timeTrackingRoutes.use('*', requireEntitlement('time_tracking'));

const MILLISECONDS_PER_MINUTE = 60000;
const MINUTES_PER_HOUR = 60;
const HOURS_DECIMAL_SCALE = 100;
const ERROR_DATE_RANGE_REQUIRED = 'startDate and endDate are required';
const ERROR_TIME_ENTRY_NOT_FOUND = 'Time entry not found';
const ERROR_TASK_NOT_FOUND = 'Task not found';
const ERROR_ACTIVE_TIMER_EXISTS = 'A timer is already running. Stop it first.';
const ERROR_NO_ACTIVE_TIMER = 'No active timer to stop';
const ERROR_END_TIME_MISSING = 'Time entry end time missing';

/**
 * List time entries for the current user.
 * GET /api/time-tracking
 */
timeTrackingRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  const taskId = c.req.query('taskId');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  const conditions = [eq(timeEntries.userId, userId)];

  if (taskId) {
    conditions.push(eq(timeEntries.taskId, taskId));
  }

  if (startDate) {
    conditions.push(gte(timeEntries.startTime, new Date(startDate)));
  }

  if (endDate) {
    conditions.push(lte(timeEntries.startTime, new Date(endDate)));
  }

  const result = await db.query.timeEntries.findMany({
    where: and(...conditions),
    with: {
      task: true,
    },
    orderBy: (timeEntries, { desc }) => [desc(timeEntries.startTime)],
  });

  return c.json({ data: result });
});

/**
 * Get time tracking summary for a date range.
 * GET /api/time-tracking/summary
 * NOTE: This must be defined before /:id to avoid matching "summary" as an id
 */
timeTrackingRoutes.get('/summary', async (c) => {
  const userId = getUserId(c);
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  if (!startDate || !endDate) {
    return c.json({ error: ERROR_DATE_RANGE_REQUIRED }, 400);
  }

  const entries = await db.query.timeEntries.findMany({
    where: and(
      eq(timeEntries.userId, userId),
      gte(timeEntries.startTime, new Date(startDate)),
      lte(timeEntries.startTime, new Date(endDate)),
    ),
    with: {
      task: {
        with: {
          project: true,
        },
      },
    },
  });

  // Calculate total minutes
  let totalMinutes = 0;
  const taskBreakdown: Record<string, number> = {};
  const projectBreakdown: Record<string, number> = {};

  for (const entry of entries) {
    if (entry.endTime) {
      const minutes = Math.round(
        (entry.endTime.getTime() - entry.startTime.getTime()) / MILLISECONDS_PER_MINUTE,
      );
      totalMinutes += minutes;

      if (entry.task) {
        const taskKey = entry.task.id;
        taskBreakdown[taskKey] = (taskBreakdown[taskKey] ?? 0) + minutes;

        if (entry.task.project) {
          const projectKey = entry.task.project.id;
          projectBreakdown[projectKey] = (projectBreakdown[projectKey] ?? 0) + minutes;
        }
      }
    }
  }

  return c.json({
    data: {
      totalMinutes,
      totalHours:
        Math.round((totalMinutes / MINUTES_PER_HOUR) * HOURS_DECIMAL_SCALE) / HOURS_DECIMAL_SCALE,
      entryCount: entries.length,
      taskBreakdown,
      projectBreakdown,
    },
  });
});

/**
 * Get the currently active time entry (timer running).
 * GET /api/time-tracking/active
 * NOTE: This must be defined before /:id to avoid matching "active" as an id
 */
timeTrackingRoutes.get('/active', async (c) => {
  const userId = getUserId(c);

  const result = await db.query.timeEntries.findFirst({
    where: and(eq(timeEntries.userId, userId), isNull(timeEntries.endTime)),
    with: {
      task: true,
    },
  });

  if (!result) {
    return c.json({ data: null });
  }

  return c.json({ data: result });
});

/**
 * Get a single time entry.
 * GET /api/time-tracking/:id
 */
timeTrackingRoutes.get('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const result = await db.query.timeEntries.findFirst({
    where: and(eq(timeEntries.id, id), eq(timeEntries.userId, userId)),
    with: {
      task: true,
    },
  });

  if (!result) {
    return c.json({ error: ERROR_TIME_ENTRY_NOT_FOUND }, 404);
  }

  return c.json({ data: result });
});

/**
 * Start a new timer.
 * POST /api/time-tracking/start
 */
timeTrackingRoutes.post('/start', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{
    taskId?: string;
    description?: string;
  }>();

  // Check if there's already an active timer
  const activeTimer = await db.query.timeEntries.findFirst({
    where: and(eq(timeEntries.userId, userId), isNull(timeEntries.endTime)),
  });

  if (activeTimer) {
    return c.json({ error: ERROR_ACTIVE_TIMER_EXISTS }, 409);
  }

  // Verify task exists and belongs to user if provided
  if (body.taskId) {
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, body.taskId),
    });

    if (!task) {
      return c.json({ error: ERROR_TASK_NOT_FOUND }, 404);
    }
  }

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(timeEntries).values({
    id,
    taskId: body.taskId,
    userId,
    startTime: now,
    description: body.description,
    createdAt: now,
    updatedAt: now,
  });

  const result = await db.query.timeEntries.findFirst({
    where: eq(timeEntries.id, id),
    with: {
      task: true,
    },
  });

  return c.json({ data: result }, 201);
});

/**
 * Stop the current timer.
 * POST /api/time-tracking/stop
 */
timeTrackingRoutes.post('/stop', async (c) => {
  const userId = getUserId(c);

  const activeTimer = await db.query.timeEntries.findFirst({
    where: and(eq(timeEntries.userId, userId), isNull(timeEntries.endTime)),
  });

  if (!activeTimer) {
    return c.json({ error: ERROR_NO_ACTIVE_TIMER }, 404);
  }

  const now = new Date();

  await db
    .update(timeEntries)
    .set({ endTime: now, updatedAt: now })
    .where(eq(timeEntries.id, activeTimer.id));

  const result = await db.query.timeEntries.findFirst({
    where: eq(timeEntries.id, activeTimer.id),
    with: {
      task: true,
    },
  });

  if (!result) {
    return c.json({ error: ERROR_TIME_ENTRY_NOT_FOUND }, 404);
  }

  if (!result.endTime) {
    return c.json({ error: ERROR_END_TIME_MISSING }, 500);
  }

  // Calculate duration
  const durationMinutes = Math.round(
    (result.endTime.getTime() - result.startTime.getTime()) / MILLISECONDS_PER_MINUTE,
  );

  return c.json({
    data: result,
    duration: {
      minutes: durationMinutes,
      formatted: formatDuration(durationMinutes),
    },
  });
});

/**
 * Switch timer to a different task (stop current, start new).
 * POST /api/time-tracking/switch
 */
timeTrackingRoutes.post('/switch', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{
    taskId?: string;
    description?: string;
  }>();

  const now = new Date();

  // Stop any active timer
  const activeTimer = await db.query.timeEntries.findFirst({
    where: and(eq(timeEntries.userId, userId), isNull(timeEntries.endTime)),
  });

  let stoppedEntry = null;
  if (activeTimer) {
    await db
      .update(timeEntries)
      .set({ endTime: now, updatedAt: now })
      .where(eq(timeEntries.id, activeTimer.id));

    stoppedEntry = await db.query.timeEntries.findFirst({
      where: eq(timeEntries.id, activeTimer.id),
      with: { task: true },
    });
  }

  // Verify new task exists if provided
  if (body.taskId) {
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, body.taskId),
    });
    if (!task) {
      return c.json({ error: ERROR_TASK_NOT_FOUND }, 404);
    }
  }

  // Start new timer
  const newId = crypto.randomUUID();
  await db.insert(timeEntries).values({
    id: newId,
    taskId: body.taskId,
    userId,
    startTime: now,
    description: body.description,
    createdAt: now,
    updatedAt: now,
  });

  const newEntry = await db.query.timeEntries.findFirst({
    where: eq(timeEntries.id, newId),
    with: { task: true },
  });

  return c.json(
    {
      data: newEntry,
      previousEntry: stoppedEntry,
    },
    201,
  );
});

/**
 * Get elapsed time of current timer.
 * GET /api/time-tracking/elapsed
 */
timeTrackingRoutes.get('/elapsed', async (c) => {
  const userId = getUserId(c);

  const activeTimer = await db.query.timeEntries.findFirst({
    where: and(eq(timeEntries.userId, userId), isNull(timeEntries.endTime)),
    with: { task: true },
  });

  if (!activeTimer) {
    return c.json({ data: null, isRunning: false });
  }

  const elapsedMs = Date.now() - activeTimer.startTime.getTime();
  const elapsedMinutes = Math.floor(elapsedMs / MILLISECONDS_PER_MINUTE);

  return c.json({
    data: activeTimer,
    isRunning: true,
    elapsed: {
      milliseconds: elapsedMs,
      minutes: elapsedMinutes,
      formatted: formatDuration(elapsedMinutes),
    },
  });
});

/**
 * Format duration in minutes to human-readable string.
 */
function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const mins = minutes % 60;
  if (hours > 0) {
    return `${String(hours)}h ${String(mins)}m`;
  }
  return `${String(mins)}m`;
}

/**
 * Create a manual time entry.
 * POST /api/time-tracking
 */
timeTrackingRoutes.post('/', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{
    taskId?: string;
    startTime: string;
    endTime: string;
    description?: string;
  }>();

  // Verify task exists if provided
  if (body.taskId) {
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, body.taskId),
    });

    if (!task) {
      return c.json({ error: ERROR_TASK_NOT_FOUND }, 404);
    }
  }

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(timeEntries).values({
    id,
    taskId: body.taskId,
    userId,
    startTime: new Date(body.startTime),
    endTime: new Date(body.endTime),
    description: body.description,
    createdAt: now,
    updatedAt: now,
  });

  const result = await db.query.timeEntries.findFirst({
    where: eq(timeEntries.id, id),
    with: {
      task: true,
    },
  });

  return c.json({ data: result }, 201);
});

/**
 * Update a time entry.
 * PATCH /api/time-tracking/:id
 */
timeTrackingRoutes.patch('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json<{
    taskId?: string | null;
    startTime?: string;
    endTime?: string | null;
    description?: string | null;
  }>();

  const existing = await db.query.timeEntries.findFirst({
    where: and(eq(timeEntries.id, id), eq(timeEntries.userId, userId)),
  });

  if (!existing) {
    return c.json({ error: ERROR_TIME_ENTRY_NOT_FOUND }, 404);
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.taskId !== undefined) updateData.taskId = body.taskId;
  if (body.startTime !== undefined) updateData.startTime = new Date(body.startTime);
  if (body.endTime !== undefined) {
    updateData.endTime = body.endTime ? new Date(body.endTime) : null;
  }
  if (body.description !== undefined) updateData.description = body.description;

  await db.update(timeEntries).set(updateData).where(eq(timeEntries.id, id));

  const result = await db.query.timeEntries.findFirst({
    where: eq(timeEntries.id, id),
    with: {
      task: true,
    },
  });

  return c.json({ data: result });
});

/**
 * Delete a time entry.
 * DELETE /api/time-tracking/:id
 */
timeTrackingRoutes.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const existing = await db.query.timeEntries.findFirst({
    where: and(eq(timeEntries.id, id), eq(timeEntries.userId, userId)),
  });

  if (!existing) {
    return c.json({ error: ERROR_TIME_ENTRY_NOT_FOUND }, 404);
  }

  await db.delete(timeEntries).where(eq(timeEntries.id, id));

  return c.body(null, 204);
});

export { timeTrackingRoutes };
