import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { and, desc, eq, gte, ilike, isNull, lt, lte, or } from 'drizzle-orm';
import type { CreateAthenaMcpServerOptions } from './types.js';
import type { SessionSubscriptions } from './subscriptions.js';
import {
  addDaysToParts,
  asRecord,
  buildCursorPage,
  decodeCursor,
  formatDateInTimeZone,
  getBooleanField,
  getStartOfDayInTimeZone,
  getStringField,
  parseDate,
  parseIsoDateParts,
} from './utils.js';
import { sendResourceUpdates } from './subscriptions.js';
import { eventScope, projectScope, taskScope } from './queries.js';

const assistantAgendaSchema = z
  .object({
    summary: z.string().optional(),
    priorityTaskIds: z.array(z.string()).optional(),
    scheduleNotes: z.array(z.string()).optional(),
    agendaItems: z
      .array(
        z.object({
          type: z.enum(['task', 'event']),
          id: z.string(),
          title: z.string(),
          startTime: z.string().optional(),
          endTime: z.string().optional(),
          reason: z.string().optional(),
        }),
      )
      .optional(),
  })
  .loose();

const supportsSampling = (server: McpServer): boolean =>
  Boolean(server.server.getClientCapabilities()?.sampling);

const parseJsonFromText = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }
    const slice = text.slice(start, end + 1);
    try {
      return JSON.parse(slice) as unknown;
    } catch {
      return null;
    }
  }
};

export function registerTools(
  server: McpServer,
  options: CreateAthenaMcpServerOptions,
  subscriptions: Map<string, SessionSubscriptions>,
): void {
  const { userId, db, schema } = options;
  const { tasks, events, projects, userSettings } = schema;

  const hasOwnedProject = async (projectId: string): Promise<boolean> => {
    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, projectId), projectScope(projects, userId)),
    });

    return Boolean(project);
  };

  const getUserTimezone = async (): Promise<string> => {
    const settings = await db.query.userSettings.findFirst({
      where: eq(userSettings.userId, userId),
    });
    const record = settings ? asRecord(settings) : null;
    const timezone = record ? getStringField(record, 'timezone') : null;
    if (!timezone) {
      return 'UTC';
    }
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
      return timezone;
    } catch {
      return 'UTC';
    }
  };

  server.registerTool(
    'list_tasks',
    {
      description: 'List tasks with optional filters',
      inputSchema: {
        status: z
          .enum(['pending', 'in_progress', 'completed', 'cancelled'])
          .optional()
          .describe('Filter by status'),
        projectId: z.uuid().optional().describe('Filter by project'),
        limit: z.number().min(1).max(100).optional().describe('Max results'),
        cursor: z.string().optional().describe('Pagination cursor'),
      },
    },
    async (args, extra) => {
      await server.sendLoggingMessage({ level: 'info', data: 'tool: list_tasks' }, extra.sessionId);
      const limit = args.limit ?? 50;
      const cursor = decodeCursor(args.cursor ?? null);
      const createdAtField = tasks.createdAt;
      const taskIdField = tasks.id;
      const cursorFilter = cursor
        ? or(
            lt(createdAtField, cursor.date),
            and(eq(createdAtField, cursor.date), lt(taskIdField, cursor.id)),
          )
        : undefined;
      const data = await db.query.tasks.findMany({
        where: and(
          taskScope(tasks, userId),
          args.status ? eq(tasks.status, args.status) : undefined,
          args.projectId ? eq(tasks.projectId, args.projectId) : undefined,
          cursorFilter,
        ),
        orderBy: [desc(createdAtField), desc(taskIdField)],
        limit: limit + 1,
      });

      const page = buildCursorPage(data, limit, 'createdAt', 'id');
      return { content: [{ type: 'text', text: JSON.stringify(page, null, 2) }] };
    },
  );

  server.registerTool(
    'create_task',
    {
      description: 'Create a new task',
      inputSchema: {
        title: z.string().describe('Task title'),
        description: z.string().optional().describe('Task description'),
        priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().describe('Task priority'),
        deadline: z.iso.datetime().optional().describe('Due date'),
        projectId: z.uuid().optional().describe('Project ID to assign to'),
      },
    },
    async (args, extra) => {
      await server.sendLoggingMessage(
        { level: 'info', data: 'tool: create_task' },
        extra.sessionId,
      );
      if (args.projectId) {
        const projectOwned = await hasOwnedProject(args.projectId);
        if (!projectOwned) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  { error: 'project_not_found', projectId: args.projectId },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }
      }
      const id = crypto.randomUUID();
      const now = new Date();

      await db.insert(tasks).values({
        id,
        title: args.title,
        description: args.description ?? null,
        priority: args.priority ?? 'medium',
        deadline: args.deadline ? new Date(args.deadline) : null,
        projectId: args.projectId ?? null,
        status: 'pending',
        creatorId: userId,
        createdAt: now,
        updatedAt: now,
      });

      server.sendResourceListChanged();
      await sendResourceUpdates(
        [
          `athena://tasks/${id}`,
          'athena://tasks',
          'athena://tasks/pending',
          'athena://tasks/today',
          'athena://agenda',
        ],
        subscriptions,
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ action: 'create_task', taskId: id, title: args.title }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'update_task',
    {
      description: 'Update fields on a task',
      inputSchema: {
        taskId: z.uuid().describe('Task ID to update'),
        title: z.string().optional().describe('Updated title'),
        description: z.string().nullable().optional().describe('Updated description'),
        status: z
          .enum(['pending', 'in_progress', 'completed', 'cancelled'])
          .optional()
          .describe('Updated status'),
        priority: z
          .enum(['low', 'medium', 'high', 'urgent'])
          .optional()
          .describe('Updated priority'),
        deadline: z.iso.datetime().nullable().optional().describe('Updated deadline'),
        estimatedMinutes: z
          .number()
          .int()
          .min(0)
          .nullable()
          .optional()
          .describe('Updated estimate'),
        projectId: z.uuid().nullable().optional().describe('Updated project'),
      },
    },
    async (args, extra) => {
      await server.sendLoggingMessage(
        { level: 'info', data: 'tool: update_task' },
        extra.sessionId,
      );
      if (args.projectId !== undefined && args.projectId !== null) {
        const projectOwned = await hasOwnedProject(args.projectId);
        if (!projectOwned) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  { error: 'project_not_found', projectId: args.projectId },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }
      }
      const task = await db.query.tasks.findFirst({
        where: and(eq(tasks.id, args.taskId), taskScope(tasks, userId)),
      });

      if (!task) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'task_not_found', taskId: args.taskId }, null, 2),
            },
          ],
          isError: true,
        };
      }

      const updates: Record<string, unknown> = {};
      if (args.title !== undefined) updates.title = args.title;
      if (args.description !== undefined) updates.description = args.description;
      if (args.status !== undefined) updates.status = args.status;
      if (args.priority !== undefined) updates.priority = args.priority;
      if (args.deadline !== undefined)
        updates.deadline = args.deadline ? new Date(args.deadline) : null;
      if (args.estimatedMinutes !== undefined) updates.estimatedMinutes = args.estimatedMinutes;
      if (args.projectId !== undefined) updates.projectId = args.projectId;

      if (Object.keys(updates).length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'no_updates_provided', taskId: args.taskId }, null, 2),
            },
          ],
          isError: true,
        };
      }

      updates.updatedAt = new Date();

      await db.update(tasks).set(updates).where(eq(tasks.id, args.taskId));
      server.sendResourceListChanged();
      await sendResourceUpdates(
        [
          `athena://tasks/${args.taskId}`,
          'athena://tasks',
          'athena://tasks/pending',
          'athena://tasks/today',
          'athena://agenda',
        ],
        subscriptions,
      );

      const taskRecord = asRecord(task);
      const title = taskRecord ? (getStringField(taskRecord, 'title') ?? args.taskId) : args.taskId;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ action: 'update_task', taskId: args.taskId, title }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'complete_task',
    {
      description: 'Mark a task as completed',
      inputSchema: {
        taskId: z.uuid().describe('Task ID to complete'),
      },
    },
    async (args, extra) => {
      await server.sendLoggingMessage(
        { level: 'info', data: 'tool: complete_task' },
        extra.sessionId,
      );
      const task = await db.query.tasks.findFirst({
        where: and(eq(tasks.id, args.taskId), taskScope(tasks, userId)),
      });

      if (!task) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'task_not_found', taskId: args.taskId }, null, 2),
            },
          ],
          isError: true,
        };
      }

      await db
        .update(tasks)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(tasks.id, args.taskId));
      server.sendResourceListChanged();
      await sendResourceUpdates(
        [
          `athena://tasks/${args.taskId}`,
          'athena://tasks',
          'athena://tasks/pending',
          'athena://tasks/today',
          'athena://agenda',
        ],
        subscriptions,
      );

      const taskRecord = asRecord(task);
      const title = taskRecord ? (getStringField(taskRecord, 'title') ?? args.taskId) : args.taskId;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ action: 'complete_task', taskId: args.taskId, title }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'list_events',
    {
      description: 'List calendar events with optional date range',
      inputSchema: {
        startDate: z.iso.datetime().optional().describe('Range start'),
        endDate: z.iso.datetime().optional().describe('Range end'),
        limit: z.number().min(1).max(100).optional().describe('Max results'),
        cursor: z.string().optional().describe('Pagination cursor'),
      },
    },
    async (args, extra) => {
      await server.sendLoggingMessage(
        { level: 'info', data: 'tool: list_events' },
        extra.sessionId,
      );
      const limit = args.limit ?? 50;
      const cursor = decodeCursor(args.cursor ?? null);
      const startTimeField = events.startTime;
      const eventIdField = events.id;
      const cursorFilter = cursor
        ? or(
            lt(startTimeField, cursor.date),
            and(eq(startTimeField, cursor.date), lt(eventIdField, cursor.id)),
          )
        : undefined;
      const startDate = args.startDate ? new Date(args.startDate) : undefined;
      const endDate = args.endDate ? new Date(args.endDate) : undefined;

      const data = await db.query.events.findMany({
        where: and(
          eventScope(events, userId),
          startDate ? gte(events.startTime, startDate) : undefined,
          endDate ? lte(events.startTime, endDate) : undefined,
          cursorFilter,
        ),
        orderBy: [desc(startTimeField), desc(eventIdField)],
        limit: limit + 1,
      });

      const page = buildCursorPage(data, limit, 'startTime', 'id');
      return { content: [{ type: 'text', text: JSON.stringify(page, null, 2) }] };
    },
  );

  server.registerTool(
    'create_event',
    {
      description: 'Create a calendar event',
      inputSchema: {
        title: z.string().describe('Event title'),
        description: z.string().optional().describe('Event description'),
        startTime: z.iso.datetime().describe('Start time'),
        endTime: z.iso.datetime().optional().describe('End time'),
        location: z.string().optional().describe('Event location'),
        isAllDay: z.boolean().optional().describe('Is all-day event'),
      },
    },
    async (args, extra) => {
      await server.sendLoggingMessage(
        { level: 'info', data: 'tool: create_event' },
        extra.sessionId,
      );
      const id = crypto.randomUUID();
      const now = new Date();
      const startTime = new Date(args.startTime);
      const endTime = args.endTime ? new Date(args.endTime) : null;

      if (endTime && endTime < startTime) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { error: 'invalid_time_range', startTime: args.startTime, endTime: args.endTime },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      await db.insert(events).values({
        id,
        title: args.title,
        description: args.description ?? null,
        startTime,
        endTime,
        location: args.location ?? null,
        isAllDay: args.isAllDay ?? false,
        creatorId: userId,
        createdAt: now,
        updatedAt: now,
      });

      server.sendResourceListChanged();
      await sendResourceUpdates(
        [`athena://events/${id}`, 'athena://events', 'athena://events/upcoming', 'athena://agenda'],
        subscriptions,
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { action: 'create_event', eventId: id, title: args.title },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'update_event',
    {
      description: 'Update fields on a calendar event',
      inputSchema: {
        eventId: z.uuid().describe('Event ID to update'),
        title: z.string().optional().describe('Updated title'),
        description: z.string().nullable().optional().describe('Updated description'),
        startTime: z.iso.datetime().optional().describe('Updated start time'),
        endTime: z.iso.datetime().nullable().optional().describe('Updated end time'),
        location: z.string().nullable().optional().describe('Updated location'),
        isAllDay: z.boolean().optional().describe('Updated all-day flag'),
      },
    },
    async (args, extra) => {
      await server.sendLoggingMessage(
        { level: 'info', data: 'tool: update_event' },
        extra.sessionId,
      );
      const event = await db.query.events.findFirst({
        where: and(eq(events.id, args.eventId), eventScope(events, userId)),
      });

      if (!event) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'event_not_found', eventId: args.eventId }, null, 2),
            },
          ],
          isError: true,
        };
      }

      const currentStart = parseDate(event.startTime) ?? new Date();
      const currentEnd = parseDate(event.endTime);
      const nextStart = args.startTime ? new Date(args.startTime) : currentStart;
      const nextEnd =
        args.endTime !== undefined ? (args.endTime ? new Date(args.endTime) : null) : currentEnd;
      if (nextEnd && nextEnd < nextStart) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: 'invalid_time_range',
                  startTime: nextStart.toISOString(),
                  endTime: nextEnd.toISOString(),
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      const updates: Record<string, unknown> = {};
      if (args.title !== undefined) updates.title = args.title;
      if (args.description !== undefined) updates.description = args.description;
      if (args.startTime !== undefined) updates.startTime = new Date(args.startTime);
      if (args.endTime !== undefined)
        updates.endTime = args.endTime ? new Date(args.endTime) : null;
      if (args.location !== undefined) updates.location = args.location;
      if (args.isAllDay !== undefined) updates.isAllDay = args.isAllDay;

      if (Object.keys(updates).length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { error: 'no_updates_provided', eventId: args.eventId },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      updates.updatedAt = new Date();

      await db.update(events).set(updates).where(eq(events.id, args.eventId));
      server.sendResourceListChanged();
      await sendResourceUpdates(
        [
          `athena://events/${args.eventId}`,
          'athena://events',
          'athena://events/upcoming',
          'athena://agenda',
        ],
        subscriptions,
      );

      const eventRecord = asRecord(event);
      const title = eventRecord
        ? (getStringField(eventRecord, 'title') ?? args.eventId)
        : args.eventId;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ action: 'update_event', eventId: args.eventId, title }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'search_tasks',
    {
      description: 'Search tasks by keyword',
      inputSchema: {
        query: z.string().describe('Search query'),
        status: z
          .enum(['pending', 'in_progress', 'completed', 'cancelled'])
          .optional()
          .describe('Filter by status'),
        limit: z.number().max(50).optional().describe('Max results'),
      },
    },
    async (args, extra) => {
      await server.sendLoggingMessage(
        { level: 'info', data: 'tool: search_tasks' },
        extra.sessionId,
      );
      const limit = args.limit ?? 10;
      const searchPattern = `%${args.query}%`;

      const results = await db.query.tasks.findMany({
        where: and(
          taskScope(tasks, userId),
          args.status ? eq(tasks.status, args.status) : undefined,
          or(ilike(tasks.title, searchPattern), ilike(tasks.description, searchPattern)),
        ),
        orderBy: [desc(tasks.createdAt)],
        limit,
      });

      const limitedResults = results.slice(0, limit);
      return { content: [{ type: 'text', text: JSON.stringify(limitedResults, null, 2) }] };
    },
  );

  server.registerTool(
    'get_agenda',
    {
      description: 'Get agenda for a specific date',
      inputSchema: {
        date: z.string().optional().describe('Date in YYYY-MM-DD format (defaults to today)'),
        includeSamplingDetails: z
          .boolean()
          .optional()
          .describe('Include full task/event details in sampling prompt'),
      },
    },
    async (args, extra) => {
      await server.sendLoggingMessage({ level: 'info', data: 'tool: get_agenda' }, extra.sessionId);
      const timezone = await getUserTimezone();
      const dateString = args.date ?? formatDateInTimeZone(new Date(), timezone);
      const dateParts = parseIsoDateParts(dateString);
      if (!dateParts) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'invalid_date', date: dateString }, null, 2),
            },
          ],
          isError: true,
        };
      }

      const date = getStartOfDayInTimeZone(dateParts, timezone);
      const nextDay = getStartOfDayInTimeZone(addDaysToParts(dateParts, 1), timezone);

      const [dayTasks, dayEvents] = await Promise.all([
        db.query.tasks.findMany({
          where: and(
            taskScope(tasks, userId),
            gte(tasks.deadline, date),
            lte(tasks.deadline, nextDay),
          ),
        }),
        db.query.events.findMany({
          where: and(
            eventScope(events, userId),
            gte(events.startTime, date),
            lte(events.startTime, nextDay),
          ),
          orderBy: [events.startTime],
        }),
      ]);

      const agenda = {
        date: dateString,
        tasks: dayTasks,
        events: dayEvents,
      };

      if (supportsSampling(server)) {
        const includeSamplingDetails = args.includeSamplingDetails === true;
        const samplingTasks = dayTasks.map((task) => {
          const record = asRecord(task);
          if (!record) {
            return { id: null, title: null };
          }
          return {
            id: getStringField(record, 'id'),
            title: getStringField(record, 'title'),
            status: getStringField(record, 'status'),
            priority: getStringField(record, 'priority'),
            deadline: parseDate(record.deadline)?.toISOString() ?? null,
          };
        });
        const samplingEvents = dayEvents.map((event) => {
          const record = asRecord(event);
          if (!record) {
            return { id: null, title: null };
          }
          return {
            id: getStringField(record, 'id'),
            title: getStringField(record, 'title'),
            startTime: parseDate(record.startTime)?.toISOString() ?? null,
            endTime: parseDate(record.endTime)?.toISOString() ?? null,
            isAllDay: getBooleanField(record, 'isAllDay'),
          };
        });
        const samplingAgenda = includeSamplingDetails
          ? agenda
          : {
              date: dateString,
              tasks: samplingTasks,
              events: samplingEvents,
            };
        const promptText = [
          'You are Athena. Generate an agenda JSON summary using the provided tasks and events.',
          'Return only JSON. Do not include code fences or additional text.',
          'Required JSON keys: summary (string), priorityTaskIds (string[]), scheduleNotes (string[]), agendaItems (array).',
          'agendaItems entries must include: type ("task" or "event"), id, title, and optional startTime/endTime/reason.',
          '',
          JSON.stringify(samplingAgenda, null, 2),
        ].join('\n');

        try {
          const sampled = await server.server.createMessage({
            messages: [{ role: 'user', content: { type: 'text', text: promptText } }],
            maxTokens: 500,
            temperature: 0.2,
          });

          if (sampled.content.type === 'text') {
            const parsed = parseJsonFromText(sampled.content.text);
            const validated = assistantAgendaSchema.safeParse(parsed);
            if (validated.success) {
              const response = { ...agenda, assistantAgenda: validated.data };
              return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await server.sendLoggingMessage(
            { level: 'error', data: `sampling agenda failed: ${message}` },
            extra.sessionId,
          );
        }
      }

      return { content: [{ type: 'text', text: JSON.stringify(agenda, null, 2) }] };
    },
  );

  server.registerTool(
    'get_availability',
    {
      description: 'Get free/busy availability for a date range',
      inputSchema: {
        startDate: z.iso.datetime().describe('Start of range'),
        endDate: z.iso.datetime().describe('End of range'),
        includeEventTitles: z
          .boolean()
          .optional()
          .describe('Include event titles in busy intervals'),
      },
    },
    async (args, extra) => {
      await server.sendLoggingMessage(
        { level: 'info', data: 'tool: get_availability' },
        extra.sessionId,
      );
      const includeEventTitles = args.includeEventTitles === true;
      const rangeStart = new Date(args.startDate);
      const rangeEnd = new Date(args.endDate);

      const eventsInRange = await db.query.events.findMany({
        where: and(
          eventScope(events, userId),
          lte(events.startTime, rangeEnd),
          or(isNull(events.endTime), gte(events.endTime, rangeStart)),
        ),
        orderBy: [events.startTime],
      });

      interface Interval {
        start: Date;
        end: Date;
        title?: string | null;
      }

      const intervals: Interval[] = eventsInRange.map((event) => {
        const start = parseDate(event.startTime) ?? rangeStart;
        const isAllDay = getBooleanField(event, 'isAllDay') === true;
        let end = parseDate(event.endTime);
        if (!end) {
          if (isAllDay) {
            end = new Date(start.getTime());
            end.setDate(end.getDate() + 1);
          } else {
            end = start;
          }
        }
        if (end < start) {
          end = start;
        }
        return {
          start,
          end,
          title: includeEventTitles ? getStringField(event, 'title') : null,
        };
      });

      intervals.sort((a, b) => a.start.getTime() - b.start.getTime());

      const merged: Interval[] = [];
      for (const interval of intervals) {
        const last = merged[merged.length - 1];
        if (!last || interval.start > last.end) {
          merged.push({ ...interval });
        } else if (interval.end > last.end) {
          last.end = interval.end;
        }
      }

      const free: Interval[] = [];
      let cursor = new Date(rangeStart);

      for (const busy of merged) {
        const busyStart = busy.start < rangeStart ? rangeStart : busy.start;
        const busyEnd = busy.end > rangeEnd ? rangeEnd : busy.end;
        if (busyStart > cursor) {
          free.push({ start: new Date(cursor), end: new Date(busyStart) });
        }
        if (busyEnd > cursor) {
          cursor = new Date(busyEnd);
        }
      }

      if (cursor < rangeEnd) {
        free.push({ start: new Date(cursor), end: new Date(rangeEnd) });
      }

      const toMinutes = (start: Date, end: Date) =>
        Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
      const busyMinutes = merged.reduce(
        (sum, interval) => sum + toMinutes(interval.start, interval.end),
        0,
      );
      const freeMinutes = free.reduce(
        (sum, interval) => sum + toMinutes(interval.start, interval.end),
        0,
      );

      const payload = {
        range: { start: rangeStart.toISOString(), end: rangeEnd.toISOString() },
        busy: merged.map((interval) => {
          const entry: { start: string; end: string; title?: string } = {
            start: interval.start.toISOString(),
            end: interval.end.toISOString(),
          };
          if (includeEventTitles) {
            entry.title = interval.title ?? undefined;
          }
          return entry;
        }),
        free: free.map((interval) => ({
          start: interval.start.toISOString(),
          end: interval.end.toISOString(),
        })),
        summary: {
          busyCount: merged.length,
          freeCount: free.length,
          busyMinutes,
          freeMinutes,
        },
      };

      return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
    },
  );
}
