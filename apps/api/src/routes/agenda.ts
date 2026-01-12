/**
 * Agenda routes - daily task and event views.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { eq, and, or, gte, lte, isNull, asc, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tasks, events, timeBlocks, timeEntries, agendaTaskOrder } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { notDeleted } from '../lib/soft-delete.js';

const agendaRoutes = new Hono();

agendaRoutes.use('*', requireAuth);

const TASK_STATUS_CATEGORY = {
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
} as const;

const START_OF_DAY = [0, 0, 0, 0] as const;
const END_OF_DAY = [23, 59, 59, 999] as const;
const DAY_INCREMENT = 1;
const DEFAULT_DEADLINE_SORT_MS = 0;
const DEFAULT_SORT_DATE = new Date(DEFAULT_DEADLINE_SORT_MS);
const MINUTES_PER_HOUR = 60;
const MILLIS_PER_MINUTE = 60000;
const DEFAULT_ESTIMATE_FALLBACK_MINUTES = 0;
const DEFAULT_ESTIMATED_TASK_MINUTES = 30;
const WORKDAY_MINUTES = 480;
const UTILIZATION_CAP_PERCENT = 100;
const PERCENT_SCALE = 100;
const DEFAULT_DEADLINE_LOOKAHEAD_DAYS = 7;
const DAYS_IN_WEEK = 7;
const SUNDAY_INDEX = 0;
const SUNDAY_OFFSET = -6;
const WEEK_START_MONDAY = 1;

const toDateKey = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Get agenda for a specific date.
 * GET /api/agenda?date=YYYY-MM-DD
 */
agendaRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  const dateParam = c.req.query('date');

  // Default to today if no date provided
  const targetDate = dateParam ? new Date(dateParam) : new Date();

  // Start and end of the target day
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(...START_OF_DAY);

  const endOfDay = new Date(targetDate);
  endOfDay.setHours(...END_OF_DAY);

  // Get tasks for the user that are not completed/cancelled and have deadlines on this day
  // OR tasks that are in progress
  const userTasks = await db.query.tasks.findMany({
    where: and(
      or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId)),
      or(
        eq(tasks.statusCategory, TASK_STATUS_CATEGORY.IN_PROGRESS),
        and(
          or(
            eq(tasks.statusCategory, TASK_STATUS_CATEGORY.NOT_STARTED),
            eq(tasks.statusCategory, TASK_STATUS_CATEGORY.IN_PROGRESS),
          ),
          gte(tasks.deadline, startOfDay),
          lte(tasks.deadline, endOfDay),
        ),
      ),
    ),
    with: {
      project: true,
      tags: {
        with: {
          tag: true,
        },
      },
    },
    orderBy: (tasks, { asc }) => [asc(tasks.deadline)],
  });

  // Get events that fall on this day
  const userEvents = await db.query.events.findMany({
    where: and(
      eq(events.creatorId, userId),
      or(
        // Events that start on this day
        and(gte(events.startTime, startOfDay), lte(events.startTime, endOfDay)),
        // Events that end on this day
        and(gte(events.endTime, startOfDay), lte(events.endTime, endOfDay)),
        // All-day events or events that span this day
        and(lte(events.startTime, startOfDay), gte(events.endTime, endOfDay)),
      ),
    ),
    with: {
      participants: {
        with: {
          user: true,
        },
      },
    },
    orderBy: (events, { asc }) => [asc(events.startTime)],
  });

  // Get custom task order for this date
  const customOrder = await db.query.agendaTaskOrder.findMany({
    where: and(
      eq(agendaTaskOrder.userId, userId),
      gte(agendaTaskOrder.agendaDate, startOfDay),
      lte(agendaTaskOrder.agendaDate, endOfDay),
    ),
    orderBy: [asc(agendaTaskOrder.position)],
  });

  // Create position map for custom ordering
  const taskPositionMap = new Map<string, number>();
  customOrder.forEach((order, index) => {
    taskPositionMap.set(order.taskId, index);
  });

  // Sort tasks: custom ordered first, then by deadline
  const sortedTasks = [...userTasks].sort((a, b) => {
    const posA = taskPositionMap.get(a.id);
    const posB = taskPositionMap.get(b.id);

    // Both have custom positions - sort by position
    if (posA !== undefined && posB !== undefined) {
      return posA - posB;
    }
    // Only A has custom position - A comes first
    if (posA !== undefined) {
      return -1;
    }
    // Only B has custom position - B comes first
    if (posB !== undefined) {
      return 1;
    }
    // Neither has custom position - sort by deadline
    const deadlineA = a.deadline?.getTime() ?? DEFAULT_DEADLINE_SORT_MS;
    const deadlineB = b.deadline?.getTime() ?? DEFAULT_DEADLINE_SORT_MS;
    return deadlineA - deadlineB;
  });

  // Combine and sort by time
  interface AgendaItem {
    type: 'task' | 'event';
    sortTime: Date;
    customPosition?: number;
    data: (typeof userTasks)[number] | (typeof userEvents)[number];
  }

  const agendaItems: AgendaItem[] = [];

  for (const task of sortedTasks) {
    agendaItems.push({
      type: 'task',
      sortTime: task.deadline ?? DEFAULT_SORT_DATE,
      customPosition: taskPositionMap.get(task.id),
      data: task,
    });
  }

  for (const event of userEvents) {
    agendaItems.push({
      type: 'event',
      sortTime: event.startTime,
      data: event,
    });
  }

  // Sort: events by time, tasks maintain their sorted order (respecting custom positions)
  // Tasks with custom positions go first, then events interleaved with remaining tasks
  agendaItems.sort((a, b) => {
    // If both are tasks, maintain their sorted order
    if (a.type === 'task' && b.type === 'task') {
      return 0; // Already sorted
    }
    // Events go by their start time
    return a.sortTime.getTime() - b.sortTime.getTime();
  });

  // Calculate summary stats
  const totalTasks = userTasks.length;
  const completedTasks = userTasks.filter(
    (task) => task.statusCategory === TASK_STATUS_CATEGORY.DONE,
  ).length;
  const estimatedMinutes = userTasks.reduce(
    (sum, t) => sum + (t.estimatedMinutes ?? DEFAULT_ESTIMATE_FALLBACK_MINUTES),
    DEFAULT_ESTIMATE_FALLBACK_MINUTES,
  );

  return c.json({
    data: {
      date: toDateKey(targetDate),
      items: agendaItems,
      summary: {
        totalTasks,
        completedTasks,
        totalEvents: userEvents.length,
        estimatedMinutes,
        estimatedHours:
          Math.round((estimatedMinutes / MINUTES_PER_HOUR) * PERCENT_SCALE) / PERCENT_SCALE,
      },
    },
  });
});

/**
 * Get agenda for a date range.
 * GET /api/agenda/range?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
agendaRoutes.get('/range', async (c) => {
  const userId = getUserId(c);
  const startDateParam = c.req.query('startDate');
  const endDateParam = c.req.query('endDate');

  if (!startDateParam || !endDateParam) {
    return c.json({ error: 'startDate and endDate are required' }, 400);
  }

  const startDate = new Date(startDateParam);
  startDate.setHours(...START_OF_DAY);

  const endDate = new Date(endDateParam);
  endDate.setHours(...END_OF_DAY);

  // Get tasks with deadlines in range
  const userTasks = await db.query.tasks.findMany({
    where: and(
      or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId)),
      or(
        eq(tasks.statusCategory, TASK_STATUS_CATEGORY.NOT_STARTED),
        eq(tasks.statusCategory, TASK_STATUS_CATEGORY.IN_PROGRESS),
      ),
      gte(tasks.deadline, startDate),
      lte(tasks.deadline, endDate),
    ),
    with: {
      project: true,
      tags: {
        with: {
          tag: true,
        },
      },
    },
    orderBy: (tasks, { asc }) => [asc(tasks.deadline)],
  });

  // Get events in range
  const userEvents = await db.query.events.findMany({
    where: and(
      eq(events.creatorId, userId),
      or(
        and(gte(events.startTime, startDate), lte(events.startTime, endDate)),
        and(gte(events.endTime, startDate), lte(events.endTime, endDate)),
        and(lte(events.startTime, startDate), gte(events.endTime, endDate)),
      ),
    ),
    with: {
      participants: {
        with: {
          user: true,
        },
      },
    },
    orderBy: (events, { asc }) => [asc(events.startTime)],
  });

  return c.json({
    data: {
      startDate: startDateParam,
      endDate: endDateParam,
      tasks: userTasks,
      events: userEvents,
      summary: {
        totalTasks: userTasks.length,
        totalEvents: userEvents.length,
      },
    },
  });
});

/**
 * Get today's agenda with time blocks and utilization.
 * GET /api/agenda/today
 */
agendaRoutes.get('/today', async (c) => {
  const userId = getUserId(c);

  const today = new Date();
  today.setHours(...START_OF_DAY);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + DAY_INCREMENT);

  // Get tasks
  const userTasks = await db.query.tasks.findMany({
    where: and(
      or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId)),
      notDeleted(tasks.deletedAt),
      or(
        eq(tasks.statusCategory, TASK_STATUS_CATEGORY.IN_PROGRESS),
        and(
          eq(tasks.statusCategory, TASK_STATUS_CATEGORY.NOT_STARTED),
          or(
            and(gte(tasks.deadline, today), lte(tasks.deadline, tomorrow)),
            isNull(tasks.deadline),
          ),
        ),
      ),
    ),
    with: {
      project: true,
    },
    orderBy: [desc(tasks.priority), asc(tasks.deadline)],
  });

  // Get events
  const userEvents = await db.query.events.findMany({
    where: and(
      eq(events.creatorId, userId),
      or(
        and(gte(events.startTime, today), lte(events.startTime, tomorrow)),
        and(lte(events.startTime, today), gte(events.endTime, today)),
      ),
    ),
    orderBy: [asc(events.startTime)],
  });

  // Get time blocks
  const userTimeBlocks = await db.query.timeBlocks.findMany({
    where: and(
      eq(timeBlocks.ownerId, userId),
      notDeleted(timeBlocks.deletedAt),
      and(gte(timeBlocks.startTime, today), lte(timeBlocks.startTime, tomorrow)),
    ),
    with: {
      tasks: {
        with: {
          task: true,
        },
      },
    },
    orderBy: [asc(timeBlocks.startTime)],
  });

  // Get time tracked today
  const todaysTimeEntries = await db.query.timeEntries.findMany({
    where: and(
      eq(timeEntries.userId, userId),
      gte(timeEntries.startTime, today),
      lte(timeEntries.startTime, tomorrow),
    ),
  });

  // Calculate time tracked
  let trackedMinutes = 0;
  for (const entry of todaysTimeEntries) {
    if (entry.endTime) {
      trackedMinutes += Math.round(
        (entry.endTime.getTime() - entry.startTime.getTime()) / MILLIS_PER_MINUTE,
      );
    }
  }

  // Calculate scheduled time from events
  let scheduledMinutes = 0;
  for (const event of userEvents) {
    if (event.endTime) {
      scheduledMinutes += Math.round(
        (event.endTime.getTime() - event.startTime.getTime()) / MILLIS_PER_MINUTE,
      );
    }
  }

  // Calculate estimated task time
  const estimatedTaskMinutes = userTasks.reduce(
    (sum, t) => sum + (t.estimatedMinutes ?? DEFAULT_ESTIMATED_TASK_MINUTES),
    DEFAULT_ESTIMATE_FALLBACK_MINUTES,
  );

  // Assume 8-hour workday (480 minutes)
  const totalWorkMinutes = WORKDAY_MINUTES;
  const utilizationPercent = Math.min(
    UTILIZATION_CAP_PERCENT,
    Math.round(((scheduledMinutes + estimatedTaskMinutes) / totalWorkMinutes) * PERCENT_SCALE),
  );

  return c.json({
    data: {
      date: toDateKey(today),
      tasks: userTasks,
      events: userEvents,
      timeBlocks: userTimeBlocks,
      summary: {
        taskCount: userTasks.length,
        eventCount: userEvents.length,
        timeBlockCount: userTimeBlocks.length,
        estimatedTaskMinutes,
        scheduledEventMinutes: scheduledMinutes,
        trackedMinutes,
        utilizationPercent,
        availableMinutes: Math.max(
          DEFAULT_ESTIMATE_FALLBACK_MINUTES,
          totalWorkMinutes - scheduledMinutes - estimatedTaskMinutes,
        ),
      },
    },
  });
});

/**
 * Reorder tasks in the agenda for a specific date.
 * POST /api/agenda/reorder
 */
agendaRoutes.post('/reorder', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{
    taskIds?: string[];
    date?: string; // YYYY-MM-DD format, defaults to today
  }>();

  if (!Array.isArray(body.taskIds)) {
    return c.json({ error: 'taskIds array is required' }, 400);
  }

  // Parse the date, default to today
  const agendaDate = body.date ? new Date(body.date) : new Date();
  agendaDate.setHours(...START_OF_DAY);

  // Verify all tasks belong to the user
  const userTasks = await db.query.tasks.findMany({
    where: and(
      or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId)),
      notDeleted(tasks.deletedAt),
    ),
  });

  const userTaskIds = new Set(userTasks.map((t) => t.id));
  const invalidIds = body.taskIds.filter((id) => !userTaskIds.has(id));

  if (invalidIds.length > 0) {
    return c.json({ error: 'Invalid task IDs', invalidIds }, 400);
  }

  // Delete existing order for this date
  const nextDay = new Date(agendaDate);
  nextDay.setDate(nextDay.getDate() + DAY_INCREMENT);

  await db
    .delete(agendaTaskOrder)
    .where(
      and(
        eq(agendaTaskOrder.userId, userId),
        gte(agendaTaskOrder.agendaDate, agendaDate),
        lte(agendaTaskOrder.agendaDate, nextDay),
      ),
    );

  // Insert new order
  const now = new Date();
  const orderValues = body.taskIds.map((taskId, index) => ({
    id: crypto.randomUUID(),
    userId,
    agendaDate,
    taskId,
    position: index,
    createdAt: now,
    updatedAt: now,
  }));

  if (orderValues.length > 0) {
    await db.insert(agendaTaskOrder).values(orderValues);
  }

  return c.json({
    success: true,
    date: toDateKey(agendaDate),
    orderedTaskIds: body.taskIds,
  });
});

/**
 * Get the custom task order for a specific date.
 * GET /api/agenda/order?date=YYYY-MM-DD
 */
agendaRoutes.get('/order', async (c) => {
  const userId = getUserId(c);
  const dateParam = c.req.query('date');

  const agendaDate = dateParam ? new Date(dateParam) : new Date();
  agendaDate.setHours(...START_OF_DAY);

  const nextDay = new Date(agendaDate);
  nextDay.setDate(nextDay.getDate() + DAY_INCREMENT);

  const order = await db.query.agendaTaskOrder.findMany({
    where: and(
      eq(agendaTaskOrder.userId, userId),
      gte(agendaTaskOrder.agendaDate, agendaDate),
      lte(agendaTaskOrder.agendaDate, nextDay),
    ),
    orderBy: [asc(agendaTaskOrder.position)],
  });

  return c.json({
    data: {
      date: toDateKey(agendaDate),
      taskIds: order.map((o) => o.taskId),
    },
  });
});

/**
 * Get upcoming deadlines.
 * GET /api/agenda/deadlines
 */
agendaRoutes.get('/deadlines', async (c) => {
  const userId = getUserId(c);
  const days = parseInt(c.req.query('days') ?? String(DEFAULT_DEADLINE_LOOKAHEAD_DAYS), 10);

  const now = new Date();
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);

  const upcomingTasks = await db.query.tasks.findMany({
    where: and(
      or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId)),
      notDeleted(tasks.deletedAt),
      or(
        eq(tasks.statusCategory, TASK_STATUS_CATEGORY.NOT_STARTED),
        eq(tasks.statusCategory, TASK_STATUS_CATEGORY.IN_PROGRESS),
      ),
      gte(tasks.deadline, now),
      lte(tasks.deadline, futureDate),
    ),
    with: {
      project: {
        columns: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: [asc(tasks.deadline)],
  });

  // Group by day
  const byDay: Record<string, typeof upcomingTasks> = {};
  for (const task of upcomingTasks) {
    if (task.deadline) {
      const dayKey = toDateKey(task.deadline);
      byDay[dayKey] ??= [];
      byDay[dayKey].push(task);
    }
  }

  return c.json({
    data: {
      tasks: upcomingTasks,
      byDay,
      totalCount: upcomingTasks.length,
      overdueCount: upcomingTasks.filter((t) => t.deadline && t.deadline < now).length,
    },
  });
});

/**
 * Get weekly overview.
 * GET /api/agenda/week
 */
agendaRoutes.get('/week', async (c) => {
  const userId = getUserId(c);
  const startDateParam = c.req.query('startDate');

  // Default to current week (Monday start)
  const startDate = startDateParam ? new Date(startDateParam) : getWeekStart(new Date());
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + DAYS_IN_WEEK);

  // Get all tasks and events for the week
  const weekTasks = await db.query.tasks.findMany({
    where: and(
      or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId)),
      notDeleted(tasks.deletedAt),
      or(
        eq(tasks.statusCategory, TASK_STATUS_CATEGORY.NOT_STARTED),
        eq(tasks.statusCategory, TASK_STATUS_CATEGORY.IN_PROGRESS),
      ),
      or(and(gte(tasks.deadline, startDate), lte(tasks.deadline, endDate)), isNull(tasks.deadline)),
    ),
    with: { project: true },
    orderBy: [asc(tasks.deadline)],
  });

  const weekEvents = await db.query.events.findMany({
    where: and(
      eq(events.creatorId, userId),
      or(
        and(gte(events.startTime, startDate), lte(events.startTime, endDate)),
        and(lte(events.startTime, startDate), gte(events.endTime, startDate)),
      ),
    ),
    orderBy: [asc(events.startTime)],
  });

  // Group by day
  const days: Record<string, { tasks: typeof weekTasks; events: typeof weekEvents }> = {};
  for (let i = 0; i < DAYS_IN_WEEK; i++) {
    const day = new Date(startDate);
    day.setDate(day.getDate() + i);
    const dayKey = toDateKey(day);
    days[dayKey] = { tasks: [], events: [] };
  }

  for (const task of weekTasks) {
    if (task.deadline) {
      const dayKey = toDateKey(task.deadline);
      const dayEntry = days[dayKey];
      if (dayEntry) {
        dayEntry.tasks.push(task);
      }
    }
  }

  for (const event of weekEvents) {
    const dayKey = toDateKey(event.startTime);
    const dayEntry = days[dayKey];
    if (dayEntry) {
      dayEntry.events.push(event);
    }
  }

  return c.json({
    data: {
      startDate: toDateKey(startDate),
      endDate: toDateKey(endDate),
      days,
      summary: {
        totalTasks: weekTasks.length,
        totalEvents: weekEvents.length,
      },
    },
  });
});

/**
 * Get Monday of the current week.
 */
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === SUNDAY_INDEX ? SUNDAY_OFFSET : WEEK_START_MONDAY);
  d.setDate(diff);
  d.setHours(...START_OF_DAY);
  return d;
}

export { agendaRoutes };
