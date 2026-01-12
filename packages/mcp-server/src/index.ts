/**
 * @packageDocumentation
 * MCP server utilities for Project Athena.
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { and, desc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';

const SERVER_INFO = {
  name: 'athena-mcp',
  version: '1.0.0',
};

/**
 * Minimal Drizzle query API needed by the MCP server.
 */
export interface AthenaMcpDbQuery {
  findMany: (args: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
  findFirst: (args: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
}

/**
 * Minimal Drizzle DB API used by the MCP server.
 */
export interface AthenaMcpDb {
  query: {
    tasks: AthenaMcpDbQuery;
    projects: AthenaMcpDbQuery;
    events: AthenaMcpDbQuery;
    initiatives: AthenaMcpDbQuery;
  };
  insert: (table: unknown) => {
    values: (
      values: Record<string, unknown>,
    ) => Promise<unknown> | { returning: (fields?: Record<string, unknown>) => Promise<unknown[]> };
  };
  update: (table: unknown) => {
    set: (values: Record<string, unknown>) => {
      where: (condition: unknown) => Promise<unknown>;
    };
  };
}

/**
 * Schema references required by the MCP server for Drizzle conditions.
 */
export interface AthenaMcpSchema {
  tasks: unknown;
  projects: unknown;
  events: unknown;
  initiatives: unknown;
}

/**
 * Options for creating an Athena MCP server instance.
 */
export interface CreateAthenaMcpServerOptions {
  userId: string;
  db: AthenaMcpDb;
  schema: AthenaMcpSchema;
}

/**
 * Create and configure an MCP server for a specific user.
 */
export function createMcpServer(options: CreateAthenaMcpServerOptions): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: {
      logging: {},
      completions: {},
      resources: {
        subscribe: true,
        listChanged: true,
      },
      tools: {},
      prompts: {},
    },
  });

  const subscriptions = new Map<string, SessionSubscriptions>();
  server.server.setRequestHandler(SubscribeRequestSchema, (request, extra) => {
    const sessionKey = getSessionKey(extra);
    if (!sessionKey) {
      return {};
    }
    const session = getSessionSubscriptions(subscriptions, sessionKey);
    session.uris.add(request.params.uri);
    session.sendNotification = extra.sendNotification;
    return {};
  });
  server.server.setRequestHandler(UnsubscribeRequestSchema, (request, extra) => {
    const sessionKey = getSessionKey(extra);
    if (!sessionKey) {
      return {};
    }
    const session = subscriptions.get(sessionKey);
    if (!session) {
      return {};
    }
    session.uris.delete(request.params.uri);
    if (session.uris.size === 0) {
      subscriptions.delete(sessionKey);
    }
    return {};
  });

  registerResources(server, options);
  registerResourceTemplates(server, options);
  registerTools(server, options, subscriptions);
  registerPrompts(server, options);

  return server;
}

/**
 * Create an HTTP transport for the MCP server.
 */
export function createMcpTransport(): WebStandardStreamableHTTPServerTransport {
  return new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return null;
};

const parseDate = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const getStringField = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key];
  return typeof value === 'string' ? value : null;
};

const getBooleanField = (record: Record<string, unknown>, key: string): boolean | null => {
  const value = record[key];
  return typeof value === 'boolean' ? value : null;
};

const getVariableValue = (
  variables: Record<string, string | string[]>,
  key: string,
): string | null => {
  const value = variables[key];
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return null;
};

const stringifyJson = (uri: string, data: unknown) => ({
  contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }],
});

const parseCursor = (cursor: string | undefined | null): number => {
  if (!cursor) {
    return 0;
  }
  const value = Number.parseInt(cursor, 10);
  return Number.isNaN(value) || value < 0 ? 0 : value;
};

const buildPage = <T>(items: T[], offset: number, limit: number) => {
  const hasNext = items.length > limit;
  const pageItems = hasNext ? items.slice(0, limit) : items;
  const nextCursor = hasNext ? String(offset + limit) : undefined;
  return { items: pageItems, nextCursor };
};

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

const isResourceSubscribed = (subscriptions: Set<string>, uri: string): boolean => {
  for (const subscription of subscriptions) {
    if (uri === subscription || uri.startsWith(`${subscription}/`)) {
      return true;
    }
  }
  return false;
};

interface SessionSubscriptions {
  uris: Set<string>;
  sendNotification?: (notification: ServerNotification) => Promise<void>;
}

const getSessionKey = (
  extra: { sessionId?: string; requestId: string | number } | undefined,
): string | null => {
  if (!extra) {
    return null;
  }
  if (extra.sessionId) {
    return extra.sessionId;
  }
  return `request-${String(extra.requestId)}`;
};

const getSessionSubscriptions = (
  subscriptions: Map<string, SessionSubscriptions>,
  sessionKey: string,
): SessionSubscriptions => {
  const existing = subscriptions.get(sessionKey);
  if (existing) {
    return existing;
  }
  const entry: SessionSubscriptions = { uris: new Set<string>() };
  subscriptions.set(sessionKey, entry);
  return entry;
};

const sendResourceUpdates = async (
  uris: string[],
  subscriptions: Map<string, SessionSubscriptions>,
) => {
  if (subscriptions.size === 0) {
    return;
  }
  const uniqueUris = Array.from(new Set(uris));
  const notifications: Promise<void>[] = [];
  for (const session of subscriptions.values()) {
    if (!session.sendNotification || session.uris.size === 0) {
      continue;
    }
    const matches = uniqueUris.filter((uri) => isResourceSubscribed(session.uris, uri));
    for (const uri of matches) {
      notifications.push(
        session.sendNotification({
          method: 'notifications/resources/updated',
          params: { uri },
        } as ServerNotification),
      );
    }
  }
  if (notifications.length === 0) {
    return;
  }
  await Promise.all(notifications);
};

function registerResources(server: McpServer, options: CreateAthenaMcpServerOptions): void {
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
        where: and(
          eq((tasks as { creatorId?: unknown }).creatorId as never, userId),
          isNull((tasks as { deletedAt?: unknown }).deletedAt as never),
        ),
        orderBy: [desc((tasks as { createdAt?: unknown }).createdAt as never)],
        limit: 100,
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
          eq((tasks as { creatorId?: unknown }).creatorId as never, userId),
          isNull((tasks as { deletedAt?: unknown }).deletedAt as never),
          gte((tasks as { deadline?: unknown }).deadline as never, today),
          lte((tasks as { deadline?: unknown }).deadline as never, tomorrow),
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
        where: and(
          eq((tasks as { creatorId?: unknown }).creatorId as never, userId),
          isNull((tasks as { deletedAt?: unknown }).deletedAt as never),
          eq((tasks as { status?: unknown }).status as never, 'pending'),
        ),
        orderBy: [desc((tasks as { priority?: unknown }).priority as never)],
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
        where: and(
          eq((projects as { ownerId?: unknown }).ownerId as never, userId),
          isNull((projects as { deletedAt?: unknown }).deletedAt as never),
        ),
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
        where: eq((events as { creatorId?: unknown }).creatorId as never, userId),
        orderBy: [desc((events as { startTime?: unknown }).startTime as never)],
        limit: 100,
      });
      return stringifyJson('athena://events', data);
    },
  );

  server.registerResource(
    'events-upcoming',
    'athena://events/upcoming',
    {
      description: 'Events in the next 7 days',
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
          eq((events as { creatorId?: unknown }).creatorId as never, userId),
          gte((events as { startTime?: unknown }).startTime as never, now),
          lte((events as { startTime?: unknown }).startTime as never, nextWeek),
        ),
        orderBy: [(events as { startTime?: unknown }).startTime as never],
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
        where: and(
          eq((initiatives as { ownerId?: unknown }).ownerId as never, userId),
          isNull((initiatives as { deletedAt?: unknown }).deletedAt as never),
        ),
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
            eq((tasks as { creatorId?: unknown }).creatorId as never, userId),
            isNull((tasks as { deletedAt?: unknown }).deletedAt as never),
            gte((tasks as { deadline?: unknown }).deadline as never, today),
            lte((tasks as { deadline?: unknown }).deadline as never, tomorrow),
          ),
        }),
        db.query.events.findMany({
          where: and(
            eq((events as { creatorId?: unknown }).creatorId as never, userId),
            gte((events as { startTime?: unknown }).startTime as never, today),
            lte((events as { startTime?: unknown }).startTime as never, tomorrow),
          ),
          orderBy: [(events as { startTime?: unknown }).startTime as never],
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

function registerResourceTemplates(server: McpServer, options: CreateAthenaMcpServerOptions): void {
  const { userId, db, schema } = options;
  const { tasks, projects, events, initiatives } = schema;

  const taskTemplate = new ResourceTemplate('athena://tasks/{taskId}', {
    list: async () => {
      await server.sendLoggingMessage({ level: 'info', data: 'resource template list: tasks' });
      const data = await db.query.tasks.findMany({
        where: and(
          eq((tasks as { creatorId?: unknown }).creatorId as never, userId),
          isNull((tasks as { deletedAt?: unknown }).deletedAt as never),
        ),
        orderBy: [desc((tasks as { createdAt?: unknown }).createdAt as never)],
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
          where: and(
            eq((tasks as { creatorId?: unknown }).creatorId as never, userId),
            isNull((tasks as { deletedAt?: unknown }).deletedAt as never),
          ),
          orderBy: [desc((tasks as { createdAt?: unknown }).createdAt as never)],
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
        where: and(
          eq((tasks as { id?: unknown }).id as never, taskId),
          eq((tasks as { creatorId?: unknown }).creatorId as never, userId),
          isNull((tasks as { deletedAt?: unknown }).deletedAt as never),
        ),
      });
      return stringifyJson(uri.toString(), task ?? null);
    },
  );

  const projectTemplate = new ResourceTemplate('athena://projects/{projectId}', {
    list: async () => {
      await server.sendLoggingMessage({ level: 'info', data: 'resource template list: projects' });
      const data = await db.query.projects.findMany({
        where: and(
          eq((projects as { ownerId?: unknown }).ownerId as never, userId),
          isNull((projects as { deletedAt?: unknown }).deletedAt as never),
        ),
        orderBy: [desc((projects as { createdAt?: unknown }).createdAt as never)],
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
          where: and(
            eq((projects as { ownerId?: unknown }).ownerId as never, userId),
            isNull((projects as { deletedAt?: unknown }).deletedAt as never),
          ),
          orderBy: [desc((projects as { createdAt?: unknown }).createdAt as never)],
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
        where: and(
          eq((projects as { id?: unknown }).id as never, projectId),
          eq((projects as { ownerId?: unknown }).ownerId as never, userId),
          isNull((projects as { deletedAt?: unknown }).deletedAt as never),
        ),
      });
      return stringifyJson(uri.toString(), project ?? null);
    },
  );

  const eventTemplate = new ResourceTemplate('athena://events/{eventId}', {
    list: async () => {
      await server.sendLoggingMessage({ level: 'info', data: 'resource template list: events' });
      const data = await db.query.events.findMany({
        where: eq((events as { creatorId?: unknown }).creatorId as never, userId),
        orderBy: [desc((events as { startTime?: unknown }).startTime as never)],
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
          where: eq((events as { creatorId?: unknown }).creatorId as never, userId),
          orderBy: [desc((events as { startTime?: unknown }).startTime as never)],
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
        where: and(
          eq((events as { id?: unknown }).id as never, eventId),
          eq((events as { creatorId?: unknown }).creatorId as never, userId),
        ),
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
        where: and(
          eq((initiatives as { ownerId?: unknown }).ownerId as never, userId),
          isNull((initiatives as { deletedAt?: unknown }).deletedAt as never),
        ),
        orderBy: [desc((initiatives as { createdAt?: unknown }).createdAt as never)],
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
          where: and(
            eq((initiatives as { ownerId?: unknown }).ownerId as never, userId),
            isNull((initiatives as { deletedAt?: unknown }).deletedAt as never),
          ),
          orderBy: [desc((initiatives as { createdAt?: unknown }).createdAt as never)],
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
        where: and(
          eq((initiatives as { id?: unknown }).id as never, initiativeId),
          eq((initiatives as { ownerId?: unknown }).ownerId as never, userId),
          isNull((initiatives as { deletedAt?: unknown }).deletedAt as never),
        ),
      });
      return stringifyJson(uri.toString(), initiative ?? null);
    },
  );
}

function registerTools(
  server: McpServer,
  options: CreateAthenaMcpServerOptions,
  subscriptions: Map<string, SessionSubscriptions>,
): void {
  const { userId, db, schema } = options;
  const { tasks, events, projects } = schema;

  const hasOwnedProject = async (projectId: string): Promise<boolean> => {
    const project = await db.query.projects.findFirst({
      where: and(
        eq((projects as { id?: unknown }).id as never, projectId),
        eq((projects as { ownerId?: unknown }).ownerId as never, userId),
        isNull((projects as { deletedAt?: unknown }).deletedAt as never),
      ),
    });

    return Boolean(project);
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
      const offset = parseCursor(args.cursor ?? null);
      const data = await db.query.tasks.findMany({
        where: and(
          eq((tasks as { creatorId?: unknown }).creatorId as never, userId),
          isNull((tasks as { deletedAt?: unknown }).deletedAt as never),
          args.status
            ? eq((tasks as { status?: unknown }).status as never, args.status)
            : undefined,
          args.projectId
            ? eq((tasks as { projectId?: unknown }).projectId as never, args.projectId)
            : undefined,
        ),
        orderBy: [desc((tasks as { createdAt?: unknown }).createdAt as never)],
        limit: limit + 1,
        offset,
      });

      const page = buildPage(data, offset, limit);
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
        where: and(
          eq((tasks as { id?: unknown }).id as never, args.taskId),
          eq((tasks as { creatorId?: unknown }).creatorId as never, userId),
          isNull((tasks as { deletedAt?: unknown }).deletedAt as never),
        ),
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

      await db
        .update(tasks)
        .set(updates)
        .where(eq((tasks as { id?: unknown }).id as never, args.taskId));
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
        where: and(
          eq((tasks as { id?: unknown }).id as never, args.taskId),
          eq((tasks as { creatorId?: unknown }).creatorId as never, userId),
          isNull((tasks as { deletedAt?: unknown }).deletedAt as never),
        ),
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
        .where(eq((tasks as { id?: unknown }).id as never, args.taskId));
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
      const offset = parseCursor(args.cursor ?? null);
      const startDate = args.startDate ? new Date(args.startDate) : undefined;
      const endDate = args.endDate ? new Date(args.endDate) : undefined;

      const data = await db.query.events.findMany({
        where: and(
          eq((events as { creatorId?: unknown }).creatorId as never, userId),
          startDate
            ? gte((events as { startTime?: unknown }).startTime as never, startDate)
            : undefined,
          endDate
            ? lte((events as { startTime?: unknown }).startTime as never, endDate)
            : undefined,
        ),
        orderBy: [desc((events as { startTime?: unknown }).startTime as never)],
        limit: limit + 1,
        offset,
      });

      const page = buildPage(data, offset, limit);
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

      await db.insert(events).values({
        id,
        title: args.title,
        description: args.description ?? null,
        startTime: new Date(args.startTime),
        endTime: args.endTime ? new Date(args.endTime) : null,
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
        where: and(
          eq((events as { id?: unknown }).id as never, args.eventId),
          eq((events as { creatorId?: unknown }).creatorId as never, userId),
        ),
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

      await db
        .update(events)
        .set(updates)
        .where(eq((events as { id?: unknown }).id as never, args.eventId));
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
      const query = args.query.toLowerCase();
      const limit = args.limit ?? 10;

      let allTasks = await db.query.tasks.findMany({
        where: and(
          eq((tasks as { creatorId?: unknown }).creatorId as never, userId),
          isNull((tasks as { deletedAt?: unknown }).deletedAt as never),
          args.status
            ? eq((tasks as { status?: unknown }).status as never, args.status)
            : undefined,
        ),
        limit: 100,
      });

      allTasks = allTasks.filter((task) => {
        const titleValue = task.title;
        const descriptionValue = task.description;
        const title = typeof titleValue === 'string' ? titleValue.toLowerCase() : '';
        const description =
          typeof descriptionValue === 'string' ? descriptionValue.toLowerCase() : '';
        return title.includes(query) || description.includes(query);
      });

      const results = allTasks.slice(0, limit);

      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.registerTool(
    'get_agenda',
    {
      description: 'Get agenda for a specific date',
      inputSchema: {
        date: z.string().optional().describe('Date in YYYY-MM-DD format (defaults to today)'),
      },
    },
    async (args, extra) => {
      await server.sendLoggingMessage({ level: 'info', data: 'tool: get_agenda' }, extra.sessionId);
      const date = args.date ? new Date(args.date) : new Date();
      date.setHours(0, 0, 0, 0);
      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);

      const [dayTasks, dayEvents] = await Promise.all([
        db.query.tasks.findMany({
          where: and(
            eq((tasks as { creatorId?: unknown }).creatorId as never, userId),
            isNull((tasks as { deletedAt?: unknown }).deletedAt as never),
            gte((tasks as { deadline?: unknown }).deadline as never, date),
            lte((tasks as { deadline?: unknown }).deadline as never, nextDay),
          ),
        }),
        db.query.events.findMany({
          where: and(
            eq((events as { creatorId?: unknown }).creatorId as never, userId),
            gte((events as { startTime?: unknown }).startTime as never, date),
            lte((events as { startTime?: unknown }).startTime as never, nextDay),
          ),
          orderBy: [(events as { startTime?: unknown }).startTime as never],
        }),
      ]);

      const agenda = {
        date: date.toISOString().split('T')[0],
        tasks: dayTasks,
        events: dayEvents,
      };

      if (supportsSampling(server)) {
        const promptText = [
          'You are Athena. Generate an agenda JSON summary using the provided tasks and events.',
          'Return only JSON. Do not include code fences or additional text.',
          'Required JSON keys: summary (string), priorityTaskIds (string[]), scheduleNotes (string[]), agendaItems (array).',
          'agendaItems entries must include: type ("task" or "event"), id, title, and optional startTime/endTime/reason.',
          '',
          JSON.stringify(agenda, null, 2),
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
      },
    },
    async (args, extra) => {
      await server.sendLoggingMessage(
        { level: 'info', data: 'tool: get_availability' },
        extra.sessionId,
      );
      const rangeStart = new Date(args.startDate);
      const rangeEnd = new Date(args.endDate);

      const eventsInRange = await db.query.events.findMany({
        where: and(
          eq((events as { creatorId?: unknown }).creatorId as never, userId),
          lte((events as { startTime?: unknown }).startTime as never, rangeEnd),
          or(
            isNull((events as { endTime?: unknown }).endTime as never),
            gte((events as { endTime?: unknown }).endTime as never, rangeStart),
          ),
        ),
        orderBy: [(events as { startTime?: unknown }).startTime as never],
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
          title: getStringField(event, 'title'),
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
        busy: merged.map((interval) => ({
          start: interval.start.toISOString(),
          end: interval.end.toISOString(),
          title: interval.title ?? undefined,
        })),
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

function registerPrompts(server: McpServer, options: CreateAthenaMcpServerOptions): void {
  const { userId, db, schema } = options;
  const { tasks, events, projects } = schema;

  server.registerPrompt(
    'daily_summary',
    {
      description: "Summarize today's tasks and events",
    },
    async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const [todayTasks, todayEvents] = await Promise.all([
        db.query.tasks.findMany({
          where: and(
            eq((tasks as { creatorId?: unknown }).creatorId as never, userId),
            isNull((tasks as { deletedAt?: unknown }).deletedAt as never),
            gte((tasks as { deadline?: unknown }).deadline as never, today),
            lte((tasks as { deadline?: unknown }).deadline as never, tomorrow),
          ),
        }),
        db.query.events.findMany({
          where: and(
            eq((events as { creatorId?: unknown }).creatorId as never, userId),
            gte((events as { startTime?: unknown }).startTime as never, today),
            lte((events as { startTime?: unknown }).startTime as never, tomorrow),
          ),
          orderBy: [(events as { startTime?: unknown }).startTime as never],
        }),
      ]);

      const completedTasks = todayTasks.filter((task) => task.status === 'completed');

      const agenda = {
        date: today.toISOString().split('T')[0],
        tasks: todayTasks,
        events: todayEvents,
        summary: {
          totalTasks: (todayTasks as unknown[]).length,
          completedTasks: completedTasks.length,
          totalEvents: (todayEvents as unknown[]).length,
        },
      };

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Here is my agenda for today:\n\n${JSON.stringify(agenda, null, 2)}\n\nGive me a concise daily summary and highlight any critical items.`,
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'daily_planning',
    {
      description: 'Generate a daily planning prompt based on current tasks and events',
    },
    async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const [todayTasks, todayEvents] = await Promise.all([
        db.query.tasks.findMany({
          where: and(
            eq((tasks as { creatorId?: unknown }).creatorId as never, userId),
            isNull((tasks as { deletedAt?: unknown }).deletedAt as never),
            gte((tasks as { deadline?: unknown }).deadline as never, today),
            lte((tasks as { deadline?: unknown }).deadline as never, tomorrow),
          ),
        }),
        db.query.events.findMany({
          where: and(
            eq((events as { creatorId?: unknown }).creatorId as never, userId),
            gte((events as { startTime?: unknown }).startTime as never, today),
            lte((events as { startTime?: unknown }).startTime as never, tomorrow),
          ),
          orderBy: [(events as { startTime?: unknown }).startTime as never],
        }),
      ]);

      const agenda = {
        date: today.toISOString().split('T')[0],
        tasks: todayTasks,
        events: todayEvents,
      };

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Here is my agenda for today:\n\n${JSON.stringify(agenda, null, 2)}\n\nHelp me plan my day. What should I prioritize? Are there any scheduling conflicts?`,
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'task_planning',
    {
      description: 'Plan tasks for the next work session',
    },
    async () => {
      const pendingTasks = await db.query.tasks.findMany({
        where: and(
          eq((tasks as { creatorId?: unknown }).creatorId as never, userId),
          isNull((tasks as { deletedAt?: unknown }).deletedAt as never),
          eq((tasks as { status?: unknown }).status as never, 'pending'),
        ),
        orderBy: [desc((tasks as { priority?: unknown }).priority as never)],
        limit: 15,
      });

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Here are my highest-priority pending tasks:\n\n${JSON.stringify(pendingTasks, null, 2)}\n\nHelp me plan the next work session. Suggest an order and timeboxing strategy.`,
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'progress_report',
    {
      description: 'Generate a progress report for a project or initiative',
      argsSchema: {
        projectId: z.uuid().optional().describe('Project to report on'),
        initiativeId: z.uuid().optional().describe('Initiative to report on'),
      },
    },
    async (args) => {
      let projectIds: string[] | null = null;

      if (args.projectId) {
        projectIds = [args.projectId];
      }

      if (args.initiativeId) {
        const linkedProjects = await db.query.projects.findMany({
          where: and(
            eq((projects as { ownerId?: unknown }).ownerId as never, userId),
            eq((projects as { initiativeId?: unknown }).initiativeId as never, args.initiativeId),
          ),
        });
        projectIds = linkedProjects
          .map((project) => getStringField(project, 'id'))
          .filter((id): id is string => id !== null);
      }

      const filterByProjects = projectIds !== null;
      const projectFilterIds = projectIds ?? [];
      let relevantTasks: unknown[] = [];

      if (!filterByProjects) {
        relevantTasks = await db.query.tasks.findMany({
          where: and(
            eq((tasks as { creatorId?: unknown }).creatorId as never, userId),
            isNull((tasks as { deletedAt?: unknown }).deletedAt as never),
            undefined,
          ),
        });
      } else if (projectFilterIds.length > 0) {
        relevantTasks = await db.query.tasks.findMany({
          where: and(
            eq((tasks as { creatorId?: unknown }).creatorId as never, userId),
            isNull((tasks as { deletedAt?: unknown }).deletedAt as never),
            inArray((tasks as { projectId?: unknown }).projectId as never, projectFilterIds),
          ),
        });
      }

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Here is the current task set for this scope:\n\n${JSON.stringify(relevantTasks, null, 2)}\n\nWrite a progress report highlighting completed work, blockers, and next steps.`,
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'task_breakdown',
    {
      description: 'Help break down a complex task into subtasks',
      argsSchema: {
        taskId: z.uuid().describe('Task ID to break down'),
      },
    },
    async (args) => {
      const task = await db.query.tasks.findFirst({
        where: and(
          eq((tasks as { id?: unknown }).id as never, args.taskId),
          eq((tasks as { creatorId?: unknown }).creatorId as never, userId),
          isNull((tasks as { deletedAt?: unknown }).deletedAt as never),
        ),
      });

      if (!task) {
        return {
          messages: [
            { role: 'user', content: { type: 'text', text: `Task not found: ${args.taskId}` } },
          ],
        };
      }

      const taskRecord = asRecord(task);
      const title = taskRecord ? (getStringField(taskRecord, 'title') ?? 'Untitled') : 'Untitled';
      const description = taskRecord
        ? (getStringField(taskRecord, 'description') ?? 'No description')
        : 'No description';
      const priority = taskRecord
        ? (getStringField(taskRecord, 'priority') ?? 'unknown')
        : 'unknown';

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `I have the following task:\n\nTitle: ${title}\nDescription: ${description}\nPriority: ${priority}\n\nHelp me break this down into smaller, actionable subtasks.`,
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'weekly_review',
    {
      description: 'Generate a weekly review prompt with accomplishments and upcoming work',
    },
    async () => {
      const now = new Date();
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);

      const [completedTasks, pendingTasks, upcomingEvents] = await Promise.all([
        db.query.tasks.findMany({
          where: and(
            eq((tasks as { creatorId?: unknown }).creatorId as never, userId),
            eq((tasks as { status?: unknown }).status as never, 'completed'),
            gte((tasks as { updatedAt?: unknown }).updatedAt as never, weekAgo),
          ),
        }),
        db.query.tasks.findMany({
          where: and(
            eq((tasks as { creatorId?: unknown }).creatorId as never, userId),
            isNull((tasks as { deletedAt?: unknown }).deletedAt as never),
            eq((tasks as { status?: unknown }).status as never, 'pending'),
          ),
        }),
        db.query.events.findMany({
          where: and(
            eq((events as { creatorId?: unknown }).creatorId as never, userId),
            gte((events as { startTime?: unknown }).startTime as never, now),
            lte((events as { startTime?: unknown }).startTime as never, nextWeek),
          ),
          orderBy: [(events as { startTime?: unknown }).startTime as never],
        }),
      ]);

      const completedCount = String((completedTasks as unknown[]).length);
      const pendingCount = String((pendingTasks as unknown[]).length);

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Here is my weekly review data:\n\nCompleted tasks this week (${completedCount}):\n${completedTasks.map((task) => `- ${getStringField(task, 'title') ?? 'Untitled'}`).join('\n')}\n\nPending tasks (${pendingCount}):\n${pendingTasks.map((task) => `- ${getStringField(task, 'title') ?? 'Untitled'}`).join('\n')}\n\nUpcoming events:\n${JSON.stringify(upcomingEvents, null, 2)}\n\nHelp me reflect on my week. What went well? What could improve? What should I focus on next week?`,
            },
          },
        ],
      };
    },
  );
}

export { McpServer };
