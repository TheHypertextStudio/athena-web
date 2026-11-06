import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';
import type { McpContext } from '../../src/mcp/auth';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import { seedStatuses, type StatusIdLookup } from '../support/routes-harness';

let schema: typeof DbModule;
let db: typeof DbModule.db;
let registerTools: typeof RegisterTools;
beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  registerTools = (await import('../../src/mcp/tools')).registerTools;
});
interface Seed {
  orgId: string;
  teamId: string;
  userId: string;
  actorId: string;
  statusId: StatusIdLookup;
  ctx: McpContext;
}
async function seedOrg(): Promise<Seed> {
  const slug = `goal-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = assertDefined(org).id;
  const statusId = await seedStatuses(db, schema, orgId);
  const email = `${slug}@e.com`;
  const [user] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email })
    .returning({ id: schema.user.id });
  const userId = assertDefined(user).id;
  const [human] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId })
    .returning({ id: schema.actor.id });
  const [team] = await db
    .insert(schema.team)
    .values({
      organizationId: orgId,
      name: 'Core',
      key: `C${Math.random().toString(36).slice(2, 6)}`,
    })
    .returning({ id: schema.team.id });
  await db.insert(schema.hub).values({ userId });
  return {
    orgId,
    teamId: assertDefined(team).id,
    userId,
    actorId: assertDefined(human).id,
    statusId,
    ctx: {
      principal: { kind: 'user', userId, userName: 'Ada', userEmail: email },
      scopes: ['work:read'],
    },
  };
}
async function seedTask(s: Seed, title: string): Promise<string> {
  const [row] = await db
    .insert(schema.task)
    .values({
      organizationId: s.orgId,
      title,
      teamId: s.teamId,
      state: 'backlog',
      statusId: s.statusId('task', 'backlog'),
      createdBy: s.actorId,
      visibility: 'public',
    })
    .returning({ id: schema.task.id });
  return assertDefined(row).id;
}
const harnesses: { close(): Promise<void> }[] = [];
async function connect(ctx: McpContext): Promise<Client> {
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerTools(server, ctx, 'sess_time_goal');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  harnesses.push({
    close: async () => {
      await client.close();
      await server.close();
    },
  });
  return client;
}
afterEach(async () => {
  while (harnesses.length > 0) await assertDefined(harnesses.pop()).close();
  resetAuthMocks();
});

describe('time goal progress', () => {
  it('reports only the qualifying distinct time for the chosen task and period', async () => {
    const s = await seedOrg();
    const selected = await seedTask(s, 'Selected work');
    const other = await seedTask(s, 'Other work');
    const [hub] = await db
      .select({ id: schema.hub.id })
      .from(schema.hub)
      .where(eq(schema.hub.userId, s.userId));
    const hubId = assertDefined(hub).id;
    async function addInterval(taskId: string, start: string, end: string) {
      const [record] = await db
        .insert(schema.timeRecord)
        .values({
          hubId,
          createdByUserId: s.userId,
          taskId,
          title: 'Tracked work',
          status: 'closed',
          startedAt: new Date(start),
          endedAt: new Date(end),
        })
        .returning({ id: schema.timeRecord.id });
      await db.insert(schema.timeInterval).values({
        timeRecordId: assertDefined(record).id,
        hubId,
        taskId,
        userId: s.userId,
        actorKind: 'human',
        mode: 'human_active',
        source: 'user_timer',
        startedAt: new Date(start),
        endedAt: new Date(end),
      });
    }
    await addInterval(selected, '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z');
    await addInterval(selected, '2026-10-01T09:30:00Z', '2026-10-01T10:30:00Z');
    await addInterval(other, '2026-10-01T10:30:00Z', '2026-10-01T11:00:00Z');
    const client = await connect(s.ctx);
    const result = await client.callTool({
      name: 'time_goal_progress',
      arguments: {
        start: '2026-10-01T09:00:00Z',
        end: '2026-10-01T12:00:00Z',
        taskId: selected,
        targetMs: 7200000,
      },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      elapsedMs: 5400000,
      targetMs: 7200000,
      satisfied: false,
    });
    expect(JSON.stringify(result)).not.toContain('Selected work');
    expect(JSON.stringify(result)).not.toContain('Other work');
  });

  it('requires work:read for personal progress', async () => {
    const s = await seedOrg();
    const client = await connect({ ...s.ctx, scopes: [] });
    const result = await client.callTool({
      name: 'time_goal_progress',
      arguments: {
        start: '2026-10-01T09:00:00Z',
        end: '2026-10-01T12:00:00Z',
        targetMs: 60000,
      },
    });
    expect(result.isError).toBe(true);
  });
});
