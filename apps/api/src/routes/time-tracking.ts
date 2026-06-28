/**
 * Time tracking routes.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  TimeEntryIdParamSchema,
  TimeEntriesQuerySchema,
  TimeSummaryQuerySchema,
  StartTimerRequestSchema,
  SwitchTimerRequestSchema,
  CreateTimeEntryRequestSchema,
  UpdateTimeEntryRequestSchema,
  TimeEntriesResponseSchema,
  TimeEntryResponseSchema,
  TimeSummaryResponseSchema,
  ActiveTimerResponseSchema,
  StopTimerResponseSchema,
  SwitchTimerResponseSchema,
  ElapsedTimeResponseSchema,
} from '@athena/types/openapi/time-tracking';
import {
  UnauthorizedErrorSchema,
  ErrorResponseSchema,
} from '@athena/types/openapi/common';
import { eq, and, isNull, gte, lte } from 'drizzle-orm';
import { db } from '../db/index.js';
import { timeEntries, tasks } from '../db/schema/index.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { requireEntitlement } from '../middleware/entitlements.js';
import { toTimeEntry } from './time-tracking/serializers.js';
import { formatDuration } from './time-tracking/helpers.js';

const timeTrackingRoutes = createOpenAPIApp();

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

// =============================================================================
// OpenAPI Route Definitions
// =============================================================================

const listTimeEntries = createRoute({
  method: 'get',
  path: '/',
  tags: ['Time Tracking'],
  summary: 'List time entries',
  description: 'List time entries for the authenticated user.',
  request: {
    query: TimeEntriesQuerySchema,
  },
  responses: {
    200: {
      description: 'Time entries retrieved successfully',
      content: {
        'application/json': {
          schema: TimeEntriesResponseSchema,
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

const getTimeSummary = createRoute({
  method: 'get',
  path: '/summary',
  tags: ['Time Tracking'],
  summary: 'Get time tracking summary',
  description: 'Get time tracking summary for a date range.',
  request: {
    query: TimeSummaryQuerySchema,
  },
  responses: {
    200: {
      description: 'Time summary retrieved successfully',
      content: {
        'application/json': {
          schema: TimeSummaryResponseSchema,
        },
      },
    },
    400: {
      description: 'Date range required',
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

const getActiveTimer = createRoute({
  method: 'get',
  path: '/active',
  tags: ['Time Tracking'],
  summary: 'Get active timer',
  description: 'Get the currently active time entry (timer running).',
  responses: {
    200: {
      description: 'Active timer retrieved successfully',
      content: {
        'application/json': {
          schema: ActiveTimerResponseSchema,
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

const getTimeEntry = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Time Tracking'],
  summary: 'Get time entry',
  description: 'Get a single time entry.',
  request: {
    params: TimeEntryIdParamSchema,
  },
  responses: {
    200: {
      description: 'Time entry retrieved successfully',
      content: {
        'application/json': {
          schema: TimeEntryResponseSchema,
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
      description: 'Time entry not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const startTimer = createRoute({
  method: 'post',
  path: '/start',
  tags: ['Time Tracking'],
  summary: 'Start timer',
  description: 'Start a new timer.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: StartTimerRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Timer started successfully',
      content: {
        'application/json': {
          schema: TimeEntryResponseSchema,
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
      description: 'Task not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Active timer already exists',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const stopTimer = createRoute({
  method: 'post',
  path: '/stop',
  tags: ['Time Tracking'],
  summary: 'Stop timer',
  description: 'Stop the current timer.',
  responses: {
    200: {
      description: 'Timer stopped successfully',
      content: {
        'application/json': {
          schema: StopTimerResponseSchema,
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
      description: 'No active timer or entry not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const switchTimer = createRoute({
  method: 'post',
  path: '/switch',
  tags: ['Time Tracking'],
  summary: 'Switch timer',
  description: 'Switch timer to a different task (stop current, start new).',
  request: {
    body: {
      content: {
        'application/json': {
          schema: SwitchTimerRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Timer switched successfully',
      content: {
        'application/json': {
          schema: SwitchTimerResponseSchema,
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
      description: 'Task not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const getElapsedTime = createRoute({
  method: 'get',
  path: '/elapsed',
  tags: ['Time Tracking'],
  summary: 'Get elapsed time',
  description: 'Get elapsed time of current timer.',
  responses: {
    200: {
      description: 'Elapsed time retrieved successfully',
      content: {
        'application/json': {
          schema: ElapsedTimeResponseSchema,
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

const createTimeEntry = createRoute({
  method: 'post',
  path: '/',
  tags: ['Time Tracking'],
  summary: 'Create time entry',
  description: 'Create a manual time entry.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateTimeEntryRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Time entry created successfully',
      content: {
        'application/json': {
          schema: TimeEntryResponseSchema,
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
      description: 'Task not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const updateTimeEntry = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Time Tracking'],
  summary: 'Update time entry',
  description: 'Update a time entry.',
  request: {
    params: TimeEntryIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateTimeEntryRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Time entry updated successfully',
      content: {
        'application/json': {
          schema: TimeEntryResponseSchema,
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
      description: 'Time entry not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const deleteTimeEntry = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Time Tracking'],
  summary: 'Delete time entry',
  description: 'Delete a time entry.',
  request: {
    params: TimeEntryIdParamSchema,
  },
  responses: {
    204: {
      description: 'Time entry deleted successfully',
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
      description: 'Time entry not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * List time entries for the current user.
 * GET /api/time-tracking
 */
timeTrackingRoutes.openapi(listTimeEntries, async (c) => {
  const userId = getUserId(c);
  const { taskId, startDate, endDate } = c.req.valid('query');

  const conditions = [eq(timeEntries.userId, userId)];

  if (taskId) {
    conditions.push(eq(timeEntries.taskId, taskId));
  }

  if (startDate) {
    conditions.push(gte(timeEntries.startTime, startDate));
  }

  if (endDate) {
    conditions.push(lte(timeEntries.startTime, endDate));
  }

  const result = await db.query.timeEntries.findMany({
    where: and(...conditions),
    with: {
      task: true,
    },
    orderBy: (timeEntries, { desc }) => [desc(timeEntries.startTime)],
  });

  return c.json({ data: result.map(toTimeEntry) }, 200);
});

/**
 * Get time tracking summary for a date range.
 * GET /api/time-tracking/summary
 * NOTE: This must be defined before /:id to avoid matching "summary" as an id
 */
timeTrackingRoutes.openapi(getTimeSummary, async (c) => {
  const userId = getUserId(c);
  const { startDate, endDate } = c.req.valid('query');

  if (!startDate || !endDate) {
    return c.json({ error: ERROR_DATE_RANGE_REQUIRED }, 400);
  }

  const entries = await db.query.timeEntries.findMany({
    where: and(
      eq(timeEntries.userId, userId),
      gte(timeEntries.startTime, startDate),
      lte(timeEntries.startTime, endDate),
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

  return c.json(
    {
      data: {
        totalMinutes,
        totalHours:
          Math.round((totalMinutes / MINUTES_PER_HOUR) * HOURS_DECIMAL_SCALE) /
          HOURS_DECIMAL_SCALE,
        entryCount: entries.length,
        taskBreakdown,
        projectBreakdown,
      },
    },
    200,
  );
});

/**
 * Get the currently active time entry (timer running).
 * GET /api/time-tracking/active
 * NOTE: This must be defined before /:id to avoid matching "active" as an id
 */
timeTrackingRoutes.openapi(getActiveTimer, async (c) => {
  const userId = getUserId(c);

  const result = await db.query.timeEntries.findFirst({
    where: and(eq(timeEntries.userId, userId), isNull(timeEntries.endTime)),
    with: {
      task: true,
    },
  });

  if (!result) {
    return c.json({ data: null }, 200);
  }

  return c.json({ data: toTimeEntry(result) }, 200);
});

/**
 * Get a single time entry.
 * GET /api/time-tracking/:id
 */
timeTrackingRoutes.openapi(getTimeEntry, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const result = await db.query.timeEntries.findFirst({
    where: and(eq(timeEntries.id, id), eq(timeEntries.userId, userId)),
    with: {
      task: true,
    },
  });

  if (!result) {
    return c.json({ error: ERROR_TIME_ENTRY_NOT_FOUND }, 404);
  }

  return c.json({ data: toTimeEntry(result) }, 200);
});

/**
 * Start a new timer.
 * POST /api/time-tracking/start
 */
timeTrackingRoutes.openapi(startTimer, async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');

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

  if (!result) {
    throw new Error('Failed to start timer');
  }

  return c.json({ data: toTimeEntry(result) }, 201);
});

/**
 * Stop the current timer.
 * POST /api/time-tracking/stop
 */
timeTrackingRoutes.openapi(stopTimer, async (c) => {
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
    throw new Error(ERROR_END_TIME_MISSING);
  }

  // Calculate duration
  const durationMinutes = Math.round(
    (result.endTime.getTime() - result.startTime.getTime()) / MILLISECONDS_PER_MINUTE,
  );

  return c.json(
    {
      data: toTimeEntry(result),
      duration: {
        minutes: durationMinutes,
        formatted: formatDuration(durationMinutes),
      },
    },
    200,
  );
});

/**
 * Switch timer to a different task (stop current, start new).
 * POST /api/time-tracking/switch
 */
timeTrackingRoutes.openapi(switchTimer, async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');

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

  if (!newEntry) {
    throw new Error('Failed to start timer');
  }

  return c.json(
    {
      data: toTimeEntry(newEntry),
      previousEntry: stoppedEntry ? toTimeEntry(stoppedEntry) : null,
    },
    201,
  );
});

/**
 * Get elapsed time of current timer.
 * GET /api/time-tracking/elapsed
 */
timeTrackingRoutes.openapi(getElapsedTime, async (c) => {
  const userId = getUserId(c);

  const activeTimer = await db.query.timeEntries.findFirst({
    where: and(eq(timeEntries.userId, userId), isNull(timeEntries.endTime)),
    with: { task: true },
  });

  if (!activeTimer) {
    return c.json({ data: null, isRunning: false }, 200);
  }

  const elapsedMs = Date.now() - activeTimer.startTime.getTime();
  const elapsedMinutes = Math.floor(elapsedMs / MILLISECONDS_PER_MINUTE);

  return c.json(
    {
      data: toTimeEntry(activeTimer),
      isRunning: true,
      elapsed: {
        milliseconds: elapsedMs,
        minutes: elapsedMinutes,
        formatted: formatDuration(elapsedMinutes),
      },
    },
    200,
  );
});

/**
 * Create a manual time entry.
 * POST /api/time-tracking
 */
timeTrackingRoutes.openapi(createTimeEntry, async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');

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
    startTime: body.startTime,
    endTime: body.endTime,
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

  if (!result) {
    throw new Error('Failed to create time entry');
  }

  return c.json({ data: toTimeEntry(result) }, 201);
});

/**
 * Update a time entry.
 * PATCH /api/time-tracking/:id
 */
timeTrackingRoutes.openapi(updateTimeEntry, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const existing = await db.query.timeEntries.findFirst({
    where: and(eq(timeEntries.id, id), eq(timeEntries.userId, userId)),
  });

  if (!existing) {
    return c.json({ error: ERROR_TIME_ENTRY_NOT_FOUND }, 404);
  }

  const updateData: Partial<typeof timeEntries.$inferInsert> = { updatedAt: new Date() };
  if (body.taskId !== undefined) updateData.taskId = body.taskId;
  if (body.startTime !== undefined) updateData.startTime = body.startTime;
  if (body.endTime !== undefined) {
    updateData.endTime = body.endTime;
  }
  if (body.description !== undefined) updateData.description = body.description;

  await db.update(timeEntries).set(updateData).where(eq(timeEntries.id, id));

  const result = await db.query.timeEntries.findFirst({
    where: eq(timeEntries.id, id),
    with: {
      task: true,
    },
  });

  if (!result) {
    throw new Error('Failed to update time entry');
  }

  return c.json({ data: toTimeEntry(result) }, 200);
});

/**
 * Delete a time entry.
 * DELETE /api/time-tracking/:id
 */
timeTrackingRoutes.openapi(deleteTimeEntry, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

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
