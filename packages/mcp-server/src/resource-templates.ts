import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { and, desc, eq } from 'drizzle-orm';
import type { CreateAthenaMcpServerOptions } from './types.js';
import { getStringField, getVariableValue, stringifyJson } from './utils.js';
import { eventScope, initiativeScope, projectScope, taskScope } from './queries.js';

export function registerResourceTemplates(
  server: McpServer,
  options: CreateAthenaMcpServerOptions,
): void {
  const { userId, db, schema } = options;
  const { tasks, projects, events, initiatives } = schema;

  const taskTemplate = new ResourceTemplate('athena://tasks/{taskId}', {
    list: async () => {
      await server.sendLoggingMessage({ level: 'info', data: 'resource template list: tasks' });
      const data = await db.query.tasks.findMany({
        where: taskScope(tasks, userId),
        orderBy: [desc(tasks.createdAt)],
        limit: 25,
      });
      const resources = data.map((task) => {
        const id = getStringField(task, 'id');
        const title = getStringField(task, 'title') ?? undefined;
        return {
          uri: id ? `athena://tasks/${id}` : 'athena://tasks/unknown',
          name: id ? `task-${id}` : 'task-unknown',
          title,
        };
      });
      return { resources };
    },
    complete: {
      taskId: async (value) => {
        const data = await db.query.tasks.findMany({
          where: taskScope(tasks, userId),
          orderBy: [desc(tasks.createdAt)],
          limit: 25,
        });
        const ids = data
          .map((task) => getStringField(task, 'id'))
          .filter((id): id is string => id !== null);
        const normalized = value.toLowerCase();
        return ids.filter((id) => id.toLowerCase().startsWith(normalized));
      },
    },
  });

  server.registerResource(
    'task-by-id',
    taskTemplate,
    {
      description: 'Task by ID',
      mimeType: 'application/json',
    },
    async (uri, variables, extra) => {
      const taskId = getVariableValue(variables, 'taskId');
      await server.sendLoggingMessage(
        { level: 'info', data: `resource template read: tasks/${taskId ?? 'unknown'}` },
        extra.sessionId,
      );
      if (!taskId) {
        return stringifyJson(uri.toString(), null);
      }
      const task = await db.query.tasks.findFirst({
        where: and(eq(tasks.id, taskId), taskScope(tasks, userId)),
      });
      return stringifyJson(uri.toString(), task ?? null);
    },
  );

  const projectTemplate = new ResourceTemplate('athena://projects/{projectId}', {
    list: async () => {
      await server.sendLoggingMessage({ level: 'info', data: 'resource template list: projects' });
      const data = await db.query.projects.findMany({
        where: projectScope(projects, userId),
        orderBy: [desc(projects.createdAt)],
        limit: 25,
      });
      const resources = data.map((project) => {
        const id = getStringField(project, 'id');
        const title = getStringField(project, 'name') ?? undefined;
        return {
          uri: id ? `athena://projects/${id}` : 'athena://projects/unknown',
          name: id ? `project-${id}` : 'project-unknown',
          title,
        };
      });
      return { resources };
    },
    complete: {
      projectId: async (value) => {
        const data = await db.query.projects.findMany({
          where: projectScope(projects, userId),
          orderBy: [desc(projects.createdAt)],
          limit: 25,
        });
        const ids = data
          .map((project) => getStringField(project, 'id'))
          .filter((id): id is string => id !== null);
        const normalized = value.toLowerCase();
        return ids.filter((id) => id.toLowerCase().startsWith(normalized));
      },
    },
  });

  server.registerResource(
    'project-by-id',
    projectTemplate,
    {
      description: 'Project by ID',
      mimeType: 'application/json',
    },
    async (uri, variables, extra) => {
      const projectId = getVariableValue(variables, 'projectId');
      await server.sendLoggingMessage(
        { level: 'info', data: `resource template read: projects/${projectId ?? 'unknown'}` },
        extra.sessionId,
      );
      if (!projectId) {
        return stringifyJson(uri.toString(), null);
      }
      const project = await db.query.projects.findFirst({
        where: and(eq(projects.id, projectId), projectScope(projects, userId)),
      });
      return stringifyJson(uri.toString(), project ?? null);
    },
  );

  const eventTemplate = new ResourceTemplate('athena://events/{eventId}', {
    list: async () => {
      await server.sendLoggingMessage({ level: 'info', data: 'resource template list: events' });
      const data = await db.query.events.findMany({
        where: eventScope(events, userId),
        orderBy: [desc(events.startTime)],
        limit: 25,
      });
      const resources = data.map((event) => {
        const id = getStringField(event, 'id');
        const title = getStringField(event, 'title') ?? undefined;
        return {
          uri: id ? `athena://events/${id}` : 'athena://events/unknown',
          name: id ? `event-${id}` : 'event-unknown',
          title,
        };
      });
      return { resources };
    },
    complete: {
      eventId: async (value) => {
        const data = await db.query.events.findMany({
          where: eventScope(events, userId),
          orderBy: [desc(events.startTime)],
          limit: 25,
        });
        const ids = data
          .map((event) => getStringField(event, 'id'))
          .filter((id): id is string => id !== null);
        const normalized = value.toLowerCase();
        return ids.filter((id) => id.toLowerCase().startsWith(normalized));
      },
    },
  });

  server.registerResource(
    'event-by-id',
    eventTemplate,
    {
      description: 'Event by ID',
      mimeType: 'application/json',
    },
    async (uri, variables, extra) => {
      const eventId = getVariableValue(variables, 'eventId');
      await server.sendLoggingMessage(
        { level: 'info', data: `resource template read: events/${eventId ?? 'unknown'}` },
        extra.sessionId,
      );
      if (!eventId) {
        return stringifyJson(uri.toString(), null);
      }
      const event = await db.query.events.findFirst({
        where: and(eq(events.id, eventId), eventScope(events, userId)),
      });
      return stringifyJson(uri.toString(), event ?? null);
    },
  );

  const initiativeTemplate = new ResourceTemplate('athena://initiatives/{initiativeId}', {
    list: async () => {
      await server.sendLoggingMessage({
        level: 'info',
        data: 'resource template list: initiatives',
      });
      const data = await db.query.initiatives.findMany({
        where: initiativeScope(initiatives, userId),
        orderBy: [desc(initiatives.createdAt)],
        limit: 25,
      });
      const resources = data.map((initiative) => {
        const id = getStringField(initiative, 'id');
        const title = getStringField(initiative, 'name') ?? undefined;
        return {
          uri: id ? `athena://initiatives/${id}` : 'athena://initiatives/unknown',
          name: id ? `initiative-${id}` : 'initiative-unknown',
          title,
        };
      });
      return { resources };
    },
    complete: {
      initiativeId: async (value) => {
        const data = await db.query.initiatives.findMany({
          where: initiativeScope(initiatives, userId),
          orderBy: [desc(initiatives.createdAt)],
          limit: 25,
        });
        const ids = data
          .map((initiative) => getStringField(initiative, 'id'))
          .filter((id): id is string => id !== null);
        const normalized = value.toLowerCase();
        return ids.filter((id) => id.toLowerCase().startsWith(normalized));
      },
    },
  });

  server.registerResource(
    'initiative-by-id',
    initiativeTemplate,
    {
      description: 'Initiative by ID',
      mimeType: 'application/json',
    },
    async (uri, variables, extra) => {
      const initiativeId = getVariableValue(variables, 'initiativeId');
      await server.sendLoggingMessage(
        { level: 'info', data: `resource template read: initiatives/${initiativeId ?? 'unknown'}` },
        extra.sessionId,
      );
      if (!initiativeId) {
        return stringifyJson(uri.toString(), null);
      }
      const initiative = await db.query.initiatives.findFirst({
        where: and(eq(initiatives.id, initiativeId), initiativeScope(initiatives, userId)),
      });
      return stringifyJson(uri.toString(), initiative ?? null);
    },
  );
}
