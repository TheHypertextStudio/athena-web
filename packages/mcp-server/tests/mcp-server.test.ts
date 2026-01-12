/**
 * MCP server unit tests for scoping, pagination, and subscriptions.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { PgDialect, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createMcpServer } from '../src/index.js';
import { taskScope } from '../src/queries.js';
import type { AthenaMcpDb, AthenaMcpSchema } from '../src/types.js';

const tasks = pgTable('tasks', {
  id: uuid('id'),
  title: text('title'),
  description: text('description'),
  priority: text('priority'),
  deadline: timestamp('deadline'),
  status: text('status'),
  creatorId: uuid('creator_id'),
  projectId: uuid('project_id'),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
  deletedAt: timestamp('deleted_at'),
});

const projects = pgTable('projects', {
  id: uuid('id'),
  ownerId: uuid('owner_id'),
  initiativeId: uuid('initiative_id'),
  createdAt: timestamp('created_at'),
  deletedAt: timestamp('deleted_at'),
});

const events = pgTable('events', {
  id: uuid('id'),
  creatorId: uuid('creator_id'),
  startTime: timestamp('start_time'),
  endTime: timestamp('end_time'),
});

const initiatives = pgTable('initiatives', {
  id: uuid('id'),
  ownerId: uuid('owner_id'),
  createdAt: timestamp('created_at'),
  deletedAt: timestamp('deleted_at'),
});

const userSettings = pgTable('user_settings', {
  userId: uuid('user_id'),
});

const schema = {
  tasks,
  projects,
  events,
  initiatives,
  userSettings,
} satisfies AthenaMcpSchema;

const getTextContent = (content: unknown): { type: 'text'; text: string } => {
  if (!content || typeof content !== 'object') {
    throw new Error('Expected content block');
  }
  const typed = content as { type?: string; text?: string };
  if (typed.type !== 'text' || typeof typed.text !== 'string') {
    throw new Error('Expected text content');
  }
  return { type: 'text', text: typed.text };
};

const buildMockDb = (): AthenaMcpDb => {
  return {
    query: {
      tasks: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      projects: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      events: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      initiatives: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      userSettings: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn().mockResolvedValue(undefined),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    })),
  };
};

describe('MCP query scoping', () => {
  it('includes creator and deleted filters in task scope', () => {
    const dialect = new PgDialect();
    const scope = taskScope(schema.tasks, 'user-123');
    const { sql, params } = dialect.sqlToQuery(scope);

    expect(sql).toContain('"tasks"."creator_id"');
    expect(sql).toContain('"tasks"."deleted_at" is null');
    expect(params).toEqual(['user-123']);
  });
});

describe('MCP pagination', () => {
  let client: Client;
  let db: AthenaMcpDb;

  beforeEach(async () => {
    db = buildMockDb();
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({ userId: 'user-123', db, schema });
    await server.connect(serverTransport);

    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  it('returns a cursor for list_tasks when more results exist', async () => {
    const baseDate = new Date('2024-01-03T00:00:00.000Z');
    const mockTasks = Array.from({ length: 3 }).map((_, index) => ({
      id: `task-${String(index)}`,
      title: `Task ${String(index)}`,
      status: 'pending',
      creatorId: 'user-123',
      createdAt: new Date(baseDate.getTime() - index * 1000),
    }));
    db.query.tasks.findMany = vi.fn().mockResolvedValue(mockTasks);

    const result = await client.callTool({
      name: 'list_tasks',
      arguments: { limit: 2 },
    });

    const content = getTextContent(result.content[0]);
    const data = JSON.parse(content.text) as { items: { id: string }[]; nextCursor?: string };
    expect(data.items).toHaveLength(2);
    expect(data.nextCursor).toBeDefined();
    if (!data.nextCursor) {
      throw new Error('Expected nextCursor to be defined');
    }
    const cursorPayload = JSON.parse(
      Buffer.from(data.nextCursor, 'base64url').toString('utf8'),
    ) as { date: string; id: string };
    expect(cursorPayload.id).toBe('task-1');
    expect(new Date(cursorPayload.date).toISOString()).toBe(mockTasks[1].createdAt.toISOString());
  });
});

describe('MCP subscriptions', () => {
  let client: Client;
  let db: AthenaMcpDb;

  beforeEach(async () => {
    db = buildMockDb();
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({ userId: 'user-123', db, schema });
    await server.connect(serverTransport);

    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  it('notifies subscribed sessions on task updates', async () => {
    const notificationPromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('resource update not received'));
      }, 1000);
      client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
        clearTimeout(timeout);
        resolve(notification.params.uri);
      });
    });

    await client.subscribeResource({ uri: 'athena://tasks' });
    await client.callTool({
      name: 'create_task',
      arguments: { title: 'Subscribed Task' },
    });

    const uri = await notificationPromise;
    expect(uri.startsWith('athena://tasks')).toBe(true);
  });
});
