/**
 * Athena AI assistant tools.
 *
 * These tools allow the AI to interact with the user's data
 * in Project Athena.
 *
 * @packageDocumentation
 */

import type { ToolDefinition, ToolCall, ToolResult } from './types.js';
import { db } from '../../db/index.js';
import { tasks, projects, events, timeEntries } from '../../db/schema/index.js';
import { eq, and, or, gte, lte, like, desc, asc, isNull } from 'drizzle-orm';
import { notDeleted } from '../../lib/soft-delete.js';
import {
  getLegacyTaskStatusFromCategory,
  getTaskStatusCategoryFromValue,
} from '../tasks/schemas.js';

/**
 * Available tools for the Athena AI assistant.
 */
export const ATHENA_TOOLS: ToolDefinition[] = [
  {
    name: 'list_tasks',
    description:
      'List tasks for the current user, optionally filtered by status, project, or date range.',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter by task status',
          enum: ['pending', 'in_progress', 'completed', 'cancelled'],
        },
        projectId: {
          type: 'string',
          description: 'Filter by project ID',
        },
        startDate: {
          type: 'string',
          description: 'Filter tasks with deadline after this date (ISO format)',
        },
        endDate: {
          type: 'string',
          description: 'Filter tasks with deadline before this date (ISO format)',
        },
        limit: {
          type: 'string',
          description: 'Maximum number of tasks to return (default: 20)',
        },
      },
    },
  },
  {
    name: 'create_task',
    description: 'Create a new task for the user.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Task title (required)',
        },
        description: {
          type: 'string',
          description: 'Task description',
        },
        priority: {
          type: 'string',
          description: 'Task priority',
          enum: ['low', 'medium', 'high', 'urgent'],
        },
        deadline: {
          type: 'string',
          description: 'Task deadline (ISO format)',
        },
        projectId: {
          type: 'string',
          description: 'Project to add the task to',
        },
        estimatedMinutes: {
          type: 'string',
          description: 'Estimated time to complete in minutes',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description: 'Update an existing task.',
    parameters: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'ID of the task to update (required)',
        },
        title: {
          type: 'string',
          description: 'New task title',
        },
        description: {
          type: 'string',
          description: 'New task description',
        },
        status: {
          type: 'string',
          description: 'New task status',
          enum: ['pending', 'in_progress', 'completed', 'cancelled'],
        },
        priority: {
          type: 'string',
          description: 'New task priority',
          enum: ['low', 'medium', 'high', 'urgent'],
        },
        deadline: {
          type: 'string',
          description: 'New deadline (ISO format)',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task as completed.',
    parameters: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'ID of the task to complete (required)',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'list_projects',
    description: 'List projects for the current user.',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter by project status',
          enum: ['planning', 'active', 'on_hold', 'completed', 'cancelled'],
        },
        limit: {
          type: 'string',
          description: 'Maximum number of projects to return (default: 20)',
        },
      },
    },
  },
  {
    name: 'get_agenda',
    description: 'Get the agenda for a specific date, including tasks and events.',
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Date to get agenda for (ISO format, defaults to today)',
        },
      },
    },
  },
  {
    name: 'list_events',
    description: 'List events for a date range.',
    parameters: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: 'Start date (ISO format, required)',
        },
        endDate: {
          type: 'string',
          description: 'End date (ISO format, required)',
        },
      },
      required: ['startDate', 'endDate'],
    },
  },
  {
    name: 'create_event',
    description: 'Create a new calendar event.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Event title (required)',
        },
        description: {
          type: 'string',
          description: 'Event description',
        },
        startTime: {
          type: 'string',
          description: 'Event start time (ISO format, required)',
        },
        endTime: {
          type: 'string',
          description: 'Event end time (ISO format)',
        },
        isAllDay: {
          type: 'string',
          description: 'Whether this is an all-day event (true/false)',
        },
        location: {
          type: 'string',
          description: 'Event location',
        },
      },
      required: ['title', 'startTime'],
    },
  },
  {
    name: 'start_timer',
    description: 'Start a time tracking timer, optionally for a specific task.',
    parameters: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID to track time for',
        },
        description: {
          type: 'string',
          description: 'Description of what is being worked on',
        },
      },
    },
  },
  {
    name: 'stop_timer',
    description: 'Stop the currently running timer.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_timer_status',
    description: 'Get the status of the currently running timer.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'search_tasks',
    description: 'Search for tasks by keyword in title or description.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (required)',
        },
        limit: {
          type: 'string',
          description: 'Maximum number of results (default: 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_productivity_summary',
    description: 'Get productivity statistics for a date range.',
    parameters: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: 'Start date (ISO format, defaults to 7 days ago)',
        },
        endDate: {
          type: 'string',
          description: 'End date (ISO format, defaults to today)',
        },
      },
    },
  },
];

/**
 * Execute an Athena tool.
 */
export async function executeTool(toolCall: ToolCall, userId: string): Promise<ToolResult> {
  try {
    const result = await executeToolInternal(toolCall, userId);
    return {
      toolCallId: toolCall.id,
      result,
    };
  } catch (error) {
    return {
      toolCallId: toolCall.id,
      result: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function executeToolInternal(toolCall: ToolCall, userId: string): Promise<unknown> {
  const args = toolCall.arguments;

  switch (toolCall.name) {
    case 'list_tasks':
      return listTasks(userId, args);

    case 'create_task':
      return createTask(userId, args);

    case 'update_task':
      return updateTask(userId, args);

    case 'complete_task':
      return completeTask(userId, args);

    case 'list_projects':
      return listProjects(userId, args);

    case 'get_agenda':
      return getAgenda(userId, args);

    case 'list_events':
      return listEvents(userId, args);

    case 'create_event':
      return createEvent(userId, args);

    case 'start_timer':
      return startTimer(userId, args);

    case 'stop_timer':
      return stopTimer(userId);

    case 'get_timer_status':
      return getTimerStatus(userId);

    case 'search_tasks':
      return searchTasks(userId, args);

    case 'get_productivity_summary':
      return getProductivitySummary(userId, args);

    default:
      throw new Error(`Unknown tool: ${toolCall.name}`);
  }
}

// Tool implementations

/**
 * Helper to safely get a string property from args.
 */
function getString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Helper to safely get a number from a string property.
 */
function getNumber(args: Record<string, unknown>, key: string, defaultValue: number): number {
  const value = args[key];
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}

async function listTasks(userId: string, args: Record<string, unknown>): Promise<unknown> {
  const conditions = [
    or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId)),
    notDeleted(tasks.deletedAt),
  ];

  const status = getString(args, 'status');
  const statusCategory = getTaskStatusCategoryFromValue(status);
  if (statusCategory) {
    conditions.push(eq(tasks.statusCategory, statusCategory));
  }

  const projectId = getString(args, 'projectId');
  if (projectId) {
    conditions.push(eq(tasks.projectId, projectId));
  }

  const startDate = getString(args, 'startDate');
  if (startDate) {
    conditions.push(gte(tasks.deadline, new Date(startDate)));
  }

  const endDate = getString(args, 'endDate');
  if (endDate) {
    conditions.push(lte(tasks.deadline, new Date(endDate)));
  }

  const limit = getNumber(args, 'limit', 20);

  const result = await db.query.tasks.findMany({
    where: and(...conditions),
    with: { project: true },
    orderBy: [desc(tasks.priority), asc(tasks.deadline)],
    limit,
  });

  return {
    tasks: result.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: getLegacyTaskStatusFromCategory(t.statusCategory) ?? 'pending',
      priority: t.priority,
      deadline: t.deadline?.toISOString(),
      estimatedMinutes: t.estimatedMinutes,
      project: t.project?.name,
    })),
    count: result.length,
  };
}

async function createTask(userId: string, args: Record<string, unknown>): Promise<unknown> {
  const id = crypto.randomUUID();
  const now = new Date();

  const title = getString(args, 'title') ?? 'Untitled Task';
  const description = getString(args, 'description');
  const priorityStr = getString(args, 'priority');
  const priority: 'low' | 'medium' | 'high' | 'urgent' =
    priorityStr === 'low' ||
    priorityStr === 'medium' ||
    priorityStr === 'high' ||
    priorityStr === 'urgent'
      ? priorityStr
      : 'medium';
  const deadlineStr = getString(args, 'deadline');
  const projectIdVal = getString(args, 'projectId');
  const estimatedMinutesStr = getString(args, 'estimatedMinutes');

  await db.insert(tasks).values({
    id,
    title,
    description,
    priority,
    deadline: deadlineStr ? new Date(deadlineStr) : undefined,
    projectId: projectIdVal,
    estimatedMinutes: estimatedMinutesStr ? parseInt(estimatedMinutesStr, 10) : undefined,
    creatorId: userId,
    createdAt: now,
    updatedAt: now,
  });

  return { success: true, taskId: id, message: `Task "${title}" created successfully.` };
}

async function updateTask(userId: string, args: Record<string, unknown>): Promise<unknown> {
  const taskId = getString(args, 'taskId');
  if (!taskId) {
    throw new Error('taskId is required');
  }

  const existing = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, taskId), or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId))),
  });

  if (!existing) {
    throw new Error('Task not found or you do not have permission to update it.');
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const title = getString(args, 'title');
  const description = getString(args, 'description');
  const status = getString(args, 'status');
  const priority = getString(args, 'priority');
  const deadline = getString(args, 'deadline');

  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (status !== undefined) updates.status = status;
  if (priority !== undefined) updates.priority = priority;
  if (deadline !== undefined) updates.deadline = new Date(deadline);

  await db.update(tasks).set(updates).where(eq(tasks.id, taskId));

  return { success: true, message: 'Task updated successfully.' };
}

async function completeTask(userId: string, args: Record<string, unknown>): Promise<unknown> {
  const taskId = getString(args, 'taskId');
  if (!taskId) {
    throw new Error('taskId is required');
  }

  const existing = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, taskId), or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId))),
  });

  if (!existing) {
    throw new Error('Task not found or you do not have permission to update it.');
  }

  await db
    .update(tasks)
    .set({ status: 'completed', updatedAt: new Date() })
    .where(eq(tasks.id, taskId));

  return { success: true, message: `Task "${existing.title}" marked as completed.` };
}

async function listProjects(userId: string, args: Record<string, unknown>): Promise<unknown> {
  const conditions = [eq(projects.ownerId, userId), notDeleted(projects.deletedAt)];

  const status = getString(args, 'status');
  if (status) {
    conditions.push(
      eq(projects.status, status as 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled'),
    );
  }

  const limit = getNumber(args, 'limit', 20);

  const result = await db.query.projects.findMany({
    where: and(...conditions),
    orderBy: [desc(projects.updatedAt)],
    limit,
  });

  return {
    projects: result.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      deadline: p.deadline?.toISOString(),
    })),
    count: result.length,
  };
}

async function getAgenda(userId: string, args: Record<string, unknown>): Promise<unknown> {
  const dateStr = getString(args, 'date');
  const targetDate = dateStr ? new Date(dateStr) : new Date();
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  const userTasks = await db.query.tasks.findMany({
    where: and(
      or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId)),
      notDeleted(tasks.deletedAt),
      or(
        eq(tasks.statusCategory, 'in_progress'),
        and(
          eq(tasks.statusCategory, 'not_started'),
          gte(tasks.deadline, startOfDay),
          lte(tasks.deadline, endOfDay),
        ),
      ),
    ),
    with: { project: true },
    orderBy: [asc(tasks.deadline)],
  });

  const userEvents = await db.query.events.findMany({
    where: and(
      eq(events.creatorId, userId),
      or(
        and(gte(events.startTime, startOfDay), lte(events.startTime, endOfDay)),
        and(gte(events.endTime, startOfDay), lte(events.endTime, endOfDay)),
        and(lte(events.startTime, startOfDay), gte(events.endTime, endOfDay)),
      ),
    ),
    orderBy: [asc(events.startTime)],
  });

  return {
    date: targetDate.toISOString().split('T')[0],
    tasks: userTasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: getLegacyTaskStatusFromCategory(t.statusCategory) ?? 'pending',
      priority: t.priority,
      deadline: t.deadline?.toISOString(),
      project: t.project?.name,
    })),
    events: userEvents.map((e) => ({
      id: e.id,
      title: e.title,
      startTime: e.startTime.toISOString(),
      endTime: e.endTime?.toISOString(),
      isAllDay: e.isAllDay,
      location: e.location,
    })),
    summary: {
      taskCount: userTasks.length,
      eventCount: userEvents.length,
      estimatedMinutes: userTasks.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0),
    },
  };
}

async function listEvents(userId: string, args: Record<string, unknown>): Promise<unknown> {
  const startDateStr = getString(args, 'startDate');
  const endDateStr = getString(args, 'endDate');
  if (!startDateStr || !endDateStr) {
    throw new Error('startDate and endDate are required');
  }
  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);

  const result = await db.query.events.findMany({
    where: and(
      eq(events.creatorId, userId),
      or(
        and(gte(events.startTime, startDate), lte(events.startTime, endDate)),
        and(gte(events.endTime, startDate), lte(events.endTime, endDate)),
        and(lte(events.startTime, startDate), gte(events.endTime, endDate)),
      ),
    ),
    orderBy: [asc(events.startTime)],
  });

  return {
    events: result.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      startTime: e.startTime.toISOString(),
      endTime: e.endTime?.toISOString(),
      isAllDay: e.isAllDay,
      location: e.location,
    })),
    count: result.length,
  };
}

async function createEvent(userId: string, args: Record<string, unknown>): Promise<unknown> {
  const id = crypto.randomUUID();
  const now = new Date();

  const title = getString(args, 'title') ?? 'Untitled Event';
  const description = getString(args, 'description');
  const startTimeStr = getString(args, 'startTime');
  const endTimeStr = getString(args, 'endTime');
  const isAllDayStr = getString(args, 'isAllDay');
  const location = getString(args, 'location');

  if (!startTimeStr) {
    throw new Error('startTime is required');
  }

  await db.insert(events).values({
    id,
    title,
    description,
    startTime: new Date(startTimeStr),
    endTime: endTimeStr ? new Date(endTimeStr) : undefined,
    isAllDay: isAllDayStr === 'true',
    location,
    creatorId: userId,
    createdAt: now,
    updatedAt: now,
  });

  return { success: true, eventId: id, message: `Event "${title}" created successfully.` };
}

async function startTimer(userId: string, args: Record<string, unknown>): Promise<unknown> {
  // Check for existing active timer
  const activeTimer = await db.query.timeEntries.findFirst({
    where: and(eq(timeEntries.userId, userId), isNull(timeEntries.endTime)),
  });

  if (activeTimer) {
    throw new Error('A timer is already running. Stop it first.');
  }

  const id = crypto.randomUUID();
  const now = new Date();

  const taskId = getString(args, 'taskId');
  const description = getString(args, 'description');

  await db.insert(timeEntries).values({
    id,
    taskId,
    userId,
    startTime: now,
    description,
    createdAt: now,
    updatedAt: now,
  });

  return { success: true, timerId: id, message: 'Timer started.' };
}

async function stopTimer(userId: string): Promise<unknown> {
  const activeTimer = await db.query.timeEntries.findFirst({
    where: and(eq(timeEntries.userId, userId), isNull(timeEntries.endTime)),
    with: { task: true },
  });

  if (!activeTimer) {
    throw new Error('No active timer to stop.');
  }

  const now = new Date();
  const durationMinutes = Math.round((now.getTime() - activeTimer.startTime.getTime()) / 60000);

  await db
    .update(timeEntries)
    .set({ endTime: now, updatedAt: now })
    .where(eq(timeEntries.id, activeTimer.id));

  return {
    success: true,
    duration: {
      minutes: durationMinutes,
      formatted: formatDuration(durationMinutes),
    },
    task: activeTimer.task?.title,
    message: `Timer stopped. Duration: ${formatDuration(durationMinutes)}.`,
  };
}

async function getTimerStatus(userId: string): Promise<unknown> {
  const activeTimer = await db.query.timeEntries.findFirst({
    where: and(eq(timeEntries.userId, userId), isNull(timeEntries.endTime)),
    with: { task: true },
  });

  if (!activeTimer) {
    return { isRunning: false, message: 'No timer is currently running.' };
  }

  const elapsedMinutes = Math.floor((Date.now() - activeTimer.startTime.getTime()) / 60000);

  return {
    isRunning: true,
    elapsed: {
      minutes: elapsedMinutes,
      formatted: formatDuration(elapsedMinutes),
    },
    task: activeTimer.task?.title,
    description: activeTimer.description,
    startTime: activeTimer.startTime.toISOString(),
  };
}

async function searchTasks(userId: string, args: Record<string, unknown>): Promise<unknown> {
  const query = getString(args, 'query');
  if (!query) {
    throw new Error('query is required');
  }
  const limit = getNumber(args, 'limit', 10);

  const result = await db.query.tasks.findMany({
    where: and(
      or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId)),
      notDeleted(tasks.deletedAt),
      or(like(tasks.title, `%${query}%`), like(tasks.description, `%${query}%`)),
    ),
    with: { project: true },
    limit,
  });

  return {
    tasks: result.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: getLegacyTaskStatusFromCategory(t.statusCategory) ?? 'pending',
      priority: t.priority,
      project: t.project?.name,
    })),
    count: result.length,
    query,
  };
}

async function getProductivitySummary(
  userId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const endDateStr = getString(args, 'endDate');
  const startDateStr = getString(args, 'startDate');
  const endDate = endDateStr ? new Date(endDateStr) : new Date();
  const startDate = startDateStr
    ? new Date(startDateStr)
    : new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Get completed tasks in range
  const completedTasks = await db.query.tasks.findMany({
    where: and(
      or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId)),
      eq(tasks.statusCategory, 'done'),
      gte(tasks.updatedAt, startDate),
      lte(tasks.updatedAt, endDate),
    ),
  });

  // Get time entries in range
  const entries = await db.query.timeEntries.findMany({
    where: and(
      eq(timeEntries.userId, userId),
      gte(timeEntries.startTime, startDate),
      lte(timeEntries.startTime, endDate),
    ),
  });

  let totalTrackedMinutes = 0;
  for (const entry of entries) {
    if (entry.endTime) {
      totalTrackedMinutes += Math.round(
        (entry.endTime.getTime() - entry.startTime.getTime()) / 60000,
      );
    }
  }

  return {
    period: {
      start: startDate.toISOString().split('T')[0],
      end: endDate.toISOString().split('T')[0],
    },
    tasksCompleted: completedTasks.length,
    timeTracked: {
      minutes: totalTrackedMinutes,
      hours: Math.round((totalTrackedMinutes / 60) * 100) / 100,
      formatted: formatDuration(totalTrackedMinutes),
    },
    timeEntryCount: entries.length,
  };
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) {
    return `${String(hours)}h ${String(mins)}m`;
  }
  return `${String(mins)}m`;
}
