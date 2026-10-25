/** Correlation follows write authority while the content author remains the actual performer. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TaskActivityOut } from '@docket/connections/activity-contract';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { McpContext } from '../../src/mcp/auth';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import type tasksRouter from '../../src/routes/tasks';
import { appWithActor, one } from '../support/routes-harness';
import { getMigratedDb } from '../support/db';
import { resetAuthMocks } from '../support/auth-mock';
import { seedMcpUpdateOrg, seedMcpUpdateTask } from './mcp-update-tool-fixtures';

let schema!: typeof DbModule;
let registerTools!: typeof RegisterTools;
let tasks!: typeof tasksRouter;
const closers: (() => Promise<void>)[] = [];
beforeAll(async () => {
  schema = await getMigratedDb();
  registerTools = (await import('../../src/mcp/tools')).registerTools;
  tasks = (await import('../../src/routes/tasks')).default;
});
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
  resetAuthMocks();
});

/** Use the actual MCP registrar, metadata scope and content/mutation writers. */
async function connect(ctx: McpContext): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '1' }, { capabilities: { tools: {} } });
  registerTools(server, { ...ctx, clientId: 'codex-test', clientName: 'Codex' }, 'transport');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

/** Correlate each actual tool call with one logical work key. */
async function call(client: Client, name: string, args: Record<string, unknown>): Promise<void> {
  const result = await client.callTool({
    name,
    arguments: args,
    _meta: { 'io.docket/activity-session': 'creative-request' },
  });
  expect(result.isError).toBeFalsy();
}

/** A work key can correlate mutations across tasks without requiring a task comment. */
async function expectMutationOnlyActivity(
  app: ReturnType<typeof appWithActor>,
  taskId: string,
  otherTaskId: string,
): Promise<void> {
  const mutationOnly = (await (await app.request(`/${taskId}/activity`)).json()) as {
    items: TaskActivityOut[];
  };
  const otherActivity = (await (await app.request(`/${otherTaskId}/activity`)).json()) as {
    items: TaskActivityOut[];
  };
  const firstChange = mutationOnly.items.find((item) => item.change?.field === 'priority');
  const otherChange = otherActivity.items.find((item) => item.change?.field === 'priority');
  expect(firstChange?.session).toMatchObject({ kind: 'work' });
  expect(mutationOnly.items.some((item) => item.type === 'comment')).toBe(false);
  expect(firstChange?.change?.to).toBe('High');
  expect(otherChange?.change?.to).toBe('Low');
  expect(otherChange?.session?.id).not.toBe(firstChange?.session?.id);
}

describe('activity session authority', () => {
  it('joins a real agent comment to its mutation without merging another authorizing person', async () => {
    const db = schema.db;
    const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute', 'comment']);
    const taskId = await seedMcpUpdateTask(db, schema, seed, { title: 'Creative request' });
    const first = await connect(seed.ctx);
    await call(first, 'update', {
      orgId: seed.orgId,
      entity: 'task',
      scope: { ids: [taskId] },
      set: { priority: 'high' },
    });
    const otherTaskId = await seedMcpUpdateTask(db, schema, seed, { title: 'Publishing request' });
    await call(first, 'update', {
      orgId: seed.orgId,
      entity: 'task',
      scope: { ids: [otherTaskId] },
      set: { priority: 'low' },
    });
    const app = appWithActor(tasks, seed.orgId, ['view'], seed.actorId);
    await expectMutationOnlyActivity(app, taskId, otherTaskId);
    await call(first, 'comment', {
      orgId: seed.orgId,
      subjectType: 'task',
      subjectId: taskId,
      body: 'First result.',
    });
    const authority = one(
      await db.select().from(schema.actor).where(eq(schema.actor.id, seed.actorId)),
    );
    const user = one(
      await db
        .insert(schema.user)
        .values({ name: 'Sarah', email: `sarah-${seed.sarahId}@example.com` })
        .returning(),
    );
    await db
      .update(schema.actor)
      .set({ userId: user.id, roleId: authority.roleId })
      .where(eq(schema.actor.id, seed.sarahId));
    const second = await connect({
      ...seed.ctx,
      principal: { kind: 'user', userId: user.id, userName: 'Sarah', userEmail: user.email },
    });
    await call(second, 'comment', {
      orgId: seed.orgId,
      subjectType: 'task',
      subjectId: taskId,
      body: 'Second result.',
    });
    const response = await appWithActor(tasks, seed.orgId, ['view'], seed.actorId).request(
      `/${taskId}/activity`,
    );
    expect(response.status).toBe(200);
    const { items } = (await response.json()) as { items: TaskActivityOut[] };
    const mutation = items.find((item) => item.change?.field === 'priority');
    const a = items.find((item) => item.body === 'First result.');
    const b = items.find((item) => item.body === 'Second result.');
    expect(a?.actorId).toBeNull();
    expect(a?.session?.id).toBe(mutation?.session?.id);
    expect(b?.session?.id).not.toBe(a?.session?.id);
  });
});
