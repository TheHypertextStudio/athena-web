import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { RESOURCE_LIST_LIMIT } from './constants.js';
import type { CreateAthenaMcpServerOptions } from './types.js';
import { stringifyJson } from './utils.js';
import { eventScope, initiativeScope, projectScope, taskScope } from './queries.js';

export function registerResources(server: McpServer, options: CreateAthenaMcpServerOptions): void {
  const { userId, db, schema } = options;
  const { tasks, projects, events, initiatives } = schema;

  server.registerResource(
    'tasks',
    'athena://tasks',
    {
      description: 'All user tasks',
      mimeType: 'application/json',
    },
    async (_uri, extra) => {
      await server.sendLoggingMessage({ level: 'info', data: 'resource: tasks' }, extra.sessionId);
      const data = await db.query.tasks.findMany({
        where: taskScope(tasks, userId),
        orderBy: [desc(tasks.createdAt)],
        limit: RESOURCE_LIST_LIMIT,
      });
      return stringifyJson('athena://tasks', data);
    },
  );

  server.registerResource(
    'tasks-today',
    'athena://tasks/today',
    {
      description: 'Tasks due today',
      mimeType: 'application/json',
    },
    async (_uri, extra) => {
      await server.sendLoggingMessage(
        { level: 'info', data: 'resource: tasks/today' },
        extra.sessionId,
      );
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const data = await db.query.tasks.findMany({
        where: and(
          taskScope(tasks, userId),
          gte(tasks.deadline, today),
          lte(tasks.deadline, tomorrow),
        ),
      });
      return stringifyJson('athena://tasks/today', data);
    },
  );

  server.registerResource(
    'tasks-pending',
    'athena://tasks/pending',
    {
      description: 'All pending tasks',
      mimeType: 'application/json',
    },
    async (_uri, extra) => {
      await server.sendLoggingMessage(
        { level: 'info', data: 'resource: tasks/pending' },
        extra.sessionId,
      );
      const data = await db.query.tasks.findMany({
        where: and(taskScope(tasks, userId), eq(tasks.status, 'pending')),
        orderBy: [desc(tasks.priority)],
        limit: RESOURCE_LIST_LIMIT,
      });
      return stringifyJson('athena://tasks/pending', data);
    },
  );

  server.registerResource(
    'projects',
    'athena://projects',
    {
      description: 'All user projects',
      mimeType: 'application/json',
    },
    async (_uri, extra) => {
      await server.sendLoggingMessage(
        { level: 'info', data: 'resource: projects' },
        extra.sessionId,
      );
      const data = await db.query.projects.findMany({
        where: projectScope(projects, userId),
        orderBy: [desc(projects.createdAt)],
        limit: RESOURCE_LIST_LIMIT,
      });
      return stringifyJson('athena://projects', data);
    },
  );

  server.registerResource(
    'events',
    'athena://events',
    {
      description: 'All calendar events',
      mimeType: 'application/json',
    },
    async (_uri, extra) => {
      await server.sendLoggingMessage({ level: 'info', data: 'resource: events' }, extra.sessionId);
      const data = await db.query.events.findMany({
        where: eventScope(events, userId),
        orderBy: [desc(events.startTime)],
        limit: RESOURCE_LIST_LIMIT,
      });
      return stringifyJson('athena://events', data);
    },
  );

  server.registerResource(
    'events-upcoming',
    'athena://events/upcoming',
    {
      description: 'Upcoming events for the next 7 days',
      mimeType: 'application/json',
    },
    async (_uri, extra) => {
      await server.sendLoggingMessage(
        { level: 'info', data: 'resource: events/upcoming' },
        extra.sessionId,
      );
      const now = new Date();
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);

      const data = await db.query.events.findMany({
        where: and(
          eventScope(events, userId),
          gte(events.startTime, now),
          lte(events.startTime, nextWeek),
        ),
        orderBy: [events.startTime],
        limit: RESOURCE_LIST_LIMIT,
      });
      return stringifyJson('athena://events/upcoming', data);
    },
  );

  server.registerResource(
    'initiatives',
    'athena://initiatives',
    {
      description: 'All strategic initiatives',
      mimeType: 'application/json',
    },
    async (_uri, extra) => {
      await server.sendLoggingMessage(
        { level: 'info', data: 'resource: initiatives' },
        extra.sessionId,
      );
      const data = await db.query.initiatives.findMany({
        where: initiativeScope(initiatives, userId),
        orderBy: [desc(initiatives.createdAt)],
        limit: RESOURCE_LIST_LIMIT,
      });
      return stringifyJson('athena://initiatives', data);
    },
  );

  server.registerResource(
    'agenda',
    'athena://agenda',
    {
      description: "Today's agenda with tasks and events",
      mimeType: 'application/json',
    },
    async (_uri, extra) => {
      await server.sendLoggingMessage({ level: 'info', data: 'resource: agenda' }, extra.sessionId);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const [todayTasks, todayEvents] = await Promise.all([
        db.query.tasks.findMany({
          where: and(
            taskScope(tasks, userId),
            gte(tasks.deadline, today),
            lte(tasks.deadline, tomorrow),
          ),
        }),
        db.query.events.findMany({
          where: and(
            eventScope(events, userId),
            gte(events.startTime, today),
            lte(events.startTime, tomorrow),
          ),
          orderBy: [events.startTime],
        }),
      ]);

      const agenda = {
        date: today.toISOString().split('T')[0],
        tasks: todayTasks,
        events: todayEvents,
      };
      return stringifyJson('athena://agenda', agenda);
    },
  );
}
