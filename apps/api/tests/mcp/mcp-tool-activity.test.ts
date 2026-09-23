import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';

import type { McpContext } from '../../src/mcp/auth';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import type tasksRouter from '../../src/routes/tasks';
import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import { appWithActor } from '../support/routes-harness';
import {
  seedMcpUpdateOrg,
  seedMcpUpdateTask,
  type McpUpdateSeed,
} from './mcp-update-tool-fixtures';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let registerTools!: typeof RegisterTools;
let tasks!: typeof tasksRouter;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  registerTools = (await import('../../src/mcp/tools')).registerTools;
  tasks = (await import('../../src/routes/tasks')).default;
});

/** The parts of an Activity entry these tests read. */
interface ActivityItem {
  readonly type: string;
  readonly change: ActivityChange | null;
  readonly origin: ActivityOrigin | null;
}

/** A field change as an Activity entry carries it. */
interface ActivityChange {
  readonly field: string;
  readonly from: string | null;
  readonly to: string | null;
}

/** An Activity entry's origin. */
interface ActivityOrigin {
  readonly channel: string;
  readonly performerKind: string;
  readonly performerName: string | null;
}

const harnesses: { close(): Promise<void> }[] = [];

afterEach(async () => {
  while (harnesses.length > 0) await assertDefined(harnesses.pop()).close();
  resetAuthMocks();
});

/** A seeded org whose MCP caller is a connected client named Claude Code. */
async function seed(): Promise<McpUpdateSeed> {
  const s = await seedMcpUpdateOrg(db, schema, ['contribute', 'assign']);
  const ctx: McpContext = { ...s.ctx, clientId: 'client_claude_code', clientName: 'Claude Code' };
  return { ...s, ctx };
}

/** Connect an MCP client to a server registered for `ctx`. */
async function connect(ctx: McpContext): Promise<Client> {
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerTools(server, ctx, 'sess_activity');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  harnesses.push({
    close: async () => {
      await client.close();
      await server.close();
    },
  });
  return client;
}

/** Call a tool and fail the test when it reports an error. */
async function call(client: Client, name: string, args: Record<string, unknown>): Promise<void> {
  const res = (await client.callTool({ name, arguments: args })) as CallToolResult;
  expect(res.isError).toBeFalsy();
}

/** The task's Activity, read through the REST route as the member. */
async function activityOf(s: McpUpdateSeed, taskId: string): Promise<readonly ActivityItem[]> {
  const res = await appWithActor(tasks, s.orgId, ['view'], s.actorId).request(
    `/${taskId}/activity`,
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: ActivityItem[] }).items;
}

/** The field-change entries for `field`. */
function changesOf(items: readonly ActivityItem[], field: string): readonly ActivityItem[] {
  return items.filter((item) => item.change?.field === field);
}

/** Assert an entry came from the Claude Code MCP client. */
function expectFromClaudeCode(item: ActivityItem | undefined): void {
  expect(item?.origin).toMatchObject({
    channel: 'mcp',
    performerKind: 'agent',
    performerName: 'Claude Code',
  });
}

describe('MCP tool activity', () => {
  it('writes an Activity entry, from the MCP client, for each field an update changes', async () => {
    const s = await seed();
    const taskId = await seedMcpUpdateTask(db, schema, s, { title: 'Book the hall' });

    await call(await connect(s.ctx), 'update', {
      orgId: s.orgId,
      entity: 'task',
      scope: { ids: [taskId] },
      set: { priority: 'urgent', dueDate: '2026-10-01' },
    });

    const items = await activityOf(s, taskId);
    const [priority] = changesOf(items, 'priority');
    expect(priority?.change?.to).not.toBeNull();
    expectFromClaudeCode(priority);
    expectFromClaudeCode(changesOf(items, 'dueDate')[0]);
  });

  it('writes one Activity entry for a state change, not two', async () => {
    const s = await seed();
    const taskId = await seedMcpUpdateTask(db, schema, s, { title: 'Send invites' });

    await call(await connect(s.ctx), 'update', {
      orgId: s.orgId,
      entity: 'task',
      scope: { ids: [taskId] },
      set: { state: 'done', priority: 'high' },
    });

    const items = await activityOf(s, taskId);
    expect(changesOf(items, 'state')).toHaveLength(1);
    expect(changesOf(items, 'priority')).toHaveLength(1);
    expectFromClaudeCode(changesOf(items, 'state')[0]);
  });

  it('writes nothing for an update that changes no field', async () => {
    const s = await seed();
    const taskId = await seedMcpUpdateTask(db, schema, s, { title: 'Order chairs' });
    const client = await connect(s.ctx);
    const set = { priority: 'low' };

    await call(client, 'update', { orgId: s.orgId, entity: 'task', scope: { ids: [taskId] }, set });
    await call(client, 'update', { orgId: s.orgId, entity: 'task', scope: { ids: [taskId] }, set });

    expect(changesOf(await activityOf(s, taskId), 'priority')).toHaveLength(1);
  });

  it('writes a dependency entry on both tasks when a link adds or removes a blocker', async () => {
    const s = await seed();
    const blocking = await seedMcpUpdateTask(db, schema, s, { title: 'Book the hall' });
    const blocked = await seedMcpUpdateTask(db, schema, s, { title: 'Send invites' });
    const client = await connect(s.ctx);
    const link = { orgId: s.orgId, relation: 'blocks', from: blocking, to: blocked };

    await call(client, 'link', link);
    await call(client, 'link', { ...link, remove: true });

    for (const taskId of [blocking, blocked]) {
      const dependency = changesOf(await activityOf(s, taskId), 'dependency');
      expect(dependency).toHaveLength(2);
      expect(dependency.some((item) => item.change?.from === null)).toBe(true);
      expect(dependency.some((item) => item.change?.to === null)).toBe(true);
      expectFromClaudeCode(dependency[0]);
    }
  });

  it('writes a parent-task entry when a link files a task under another', async () => {
    const s = await seed();
    const parent = await seedMcpUpdateTask(db, schema, s, { title: 'Run the drive' });
    const child = await seedMcpUpdateTask(db, schema, s, { title: 'Book the hall' });

    await call(await connect(s.ctx), 'link', {
      orgId: s.orgId,
      relation: 'subtask_of',
      from: child,
      to: parent,
    });

    const [entry] = changesOf(await activityOf(s, child), 'parentTaskId');
    expect(entry?.change?.from).toBeNull();
    expectFromClaudeCode(entry);
  });
});
