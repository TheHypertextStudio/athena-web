/**
 * The `track` tool: the whole timer lifecycle, reachable over MCP.
 *
 * @remarks
 * Driven through a real MCP client/server pair rather than by calling the handler, so the
 * registration, the input schema and the structured result are exercised the way an assistant
 * would meet them. What the tests care about is that MCP is not a second, laxer timer: the same
 * naming guard, the same task anchoring and the same personal-ownership boundary apply here as
 * over REST.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type { McpContext } from '../../src/mcp/auth';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let registerTools!: typeof RegisterTools;

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
  ctx: McpContext;
}

/** Seed a workspace whose caller has a Hub, so tracking has somewhere to live. */
async function seedOrg(): Promise<Seed> {
  const slug = `tt-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const orgId = org!.id;
  const email = `${slug}@e.com`;
  const [user] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email })
    .returning({ id: schema.user.id });
  const [human] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId: user!.id })
    .returning({ id: schema.actor.id });
  const [team] = await db
    .insert(schema.team)
    .values({
      organizationId: orgId,
      name: 'Core',
      key: `C${Math.random().toString(36).slice(2, 6)}`,
    })
    .returning({ id: schema.team.id });
  await db.insert(schema.hub).values({ userId: user!.id });
  return {
    orgId,
    teamId: team!.id,
    userId: user!.id,
    actorId: human!.id,
    ctx: {
      principal: { kind: 'user', userId: user!.id, userName: 'Ada', userEmail: email },
      scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
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
      createdBy: s.actorId,
    })
    .returning({ id: schema.task.id });
  return row!.id;
}

const harnesses: { close(): Promise<void> }[] = [];

async function connect(ctx: McpContext): Promise<Client> {
  const server = new McpServer(
    { name: 'test', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerTools(server, ctx, 'sess_time');
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
  while (harnesses.length > 0) await harnesses.pop()!.close();
  resetAuthMocks();
});

interface Tracking {
  state: 'running' | 'paused' | 'idle';
  timeRecordId: string | null;
  taskId: string | null;
  taskTitle: string | null;
  trackedMs: number;
}

function payload(res: CallToolResult): { tracking: Tracking; segments?: unknown[] } {
  return JSON.parse((res.content[0] as { text: string }).text) as {
    tracking: Tracking;
    segments?: unknown[];
  };
}

async function track(client: Client, args: Record<string, unknown>): Promise<CallToolResult> {
  return (await client.callTool({ name: 'track', arguments: args })) as CallToolResult;
}

describe('track', () => {
  it('is registered with the timer vocabulary an assistant needs', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    const tools = await client.listTools();
    const tool = tools.tools.find((entry) => entry.name === 'track');
    expect(tool).toBeDefined();
    const actions = (tool?.inputSchema.properties as { action?: { enum?: string[] } } | undefined)
      ?.action?.enum;
    expect(actions).toEqual(['start', 'pause', 'resume', 'switch', 'stop', 'status', 'segments']);
  });

  it('runs the whole lifecycle: start, pause, resume, switch, stop', async () => {
    const s = await seedOrg();
    const first = await seedTask(s, 'Migrate the importer');
    const second = await seedTask(s, 'Answer the support thread');
    const client = await connect(s.ctx);

    const started = payload(await track(client, { action: 'start', taskId: first }));
    expect(started.tracking).toMatchObject({
      state: 'running',
      taskId: first,
      taskTitle: 'Migrate the importer',
    });

    const paused = payload(await track(client, { action: 'pause' }));
    expect(paused.tracking.state).toBe('paused');

    const resumed = payload(
      await track(client, { action: 'resume', timeRecordId: paused.tracking.timeRecordId }),
    );
    expect(resumed.tracking.state).toBe('running');

    const switched = payload(await track(client, { action: 'switch', taskId: second }));
    expect(switched.tracking).toMatchObject({ state: 'running', taskId: second });
    expect(switched.tracking.timeRecordId).not.toBe(started.tracking.timeRecordId);

    const stopped = payload(await track(client, { action: 'stop' }));
    expect(stopped.tracking.state).toBe('idle');

    // Switching away from the first task (CORE-38) paused its record rather than ending it, and
    // it was never explicitly stopped or resumed afterward — it is still a genuine, resumable
    // paused session. `status` with no explicit `timeRecordId` resolves to whatever `getActiveTime`
    // reports (CORE-36: `status IN ('open', 'paused')`, `'open'` first), so once the second task's
    // record is `'closed'` the first task's still-paused one is exactly what should resurface, not
    // a blank idle state that would make the paused session unreachable from `status`.
    const stillPaused = payload(await track(client, { action: 'status' }));
    expect(stillPaused.tracking).toMatchObject({
      state: 'paused',
      taskId: first,
      timeRecordId: started.tracking.timeRecordId,
    });

    // Idle is reached by explicitly stopping that dangling paused session too.
    const stoppedFirst = payload(
      await track(client, { action: 'stop', timeRecordId: started.tracking.timeRecordId }),
    );
    expect(stoppedFirst.tracking.state).toBe('idle');

    const idle = payload(await track(client, { action: 'status' }));
    expect(idle.tracking).toMatchObject({ state: 'idle', taskId: null });
  });

  it('creates an ordinary task when asked to track a bare label', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    const started = payload(
      await track(client, { action: 'start', label: 'Untangle the deploy', orgId: s.orgId }),
    );
    expect(started.tracking.taskId).toEqual(expect.any(String));
    const rows = await db
      .select({ title: schema.task.title, organizationId: schema.task.organizationId })
      .from(schema.task)
      .where(eq(schema.task.id, started.tracking.taskId!));
    expect(rows[0]).toEqual({ title: 'Untangle the deploy', organizationId: s.orgId });
  });

  it('refuses to start without saying what is being worked on', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    const refused = await track(client, { action: 'start' });
    expect(refused.isError).toBe(true);
  });

  it('lists the segments recorded in a period', async () => {
    const s = await seedOrg();
    const taskId = await seedTask(s, 'Segmented work');
    const client = await connect(s.ctx);
    await track(client, { action: 'start', taskId });
    await track(client, { action: 'stop' });

    const listed = payload(
      await track(client, {
        action: 'segments',
        start: '2020-01-01T00:00:00.000Z',
        end: '2040-01-01T00:00:00.000Z',
      }),
    );
    expect(listed.segments).toEqual([
      expect.objectContaining({ taskId, taskTitle: 'Segmented work', running: false }),
    ]);
  });

  // CORE-42: the naming guard is the SERVER's, not a client affordance — it must hold over MCP
  // exactly as it does over REST (see `tests/routes/time.test.ts`'s matching REST case).
  it('refuses to stop over MCP when the tracked task has no name, and leaves it running', async () => {
    const s = await seedOrg();
    const taskId = await seedTask(s, 'Nameable work');
    const client = await connect(s.ctx);
    const started = payload(await track(client, { action: 'start', taskId }));
    const recordId = started.tracking.timeRecordId!;

    // Bypass every client and every validator, exactly as the REST case does: blank the record's
    // own label directly in storage so the stop-time guard is the only thing left to catch it.
    await db
      .update(schema.timeRecord)
      .set({ title: '   ' })
      .where(eq(schema.timeRecord.id, recordId));

    const refused = await track(client, { action: 'stop' });
    expect(refused.isError).toBe(true);
    const message = (refused.content[0] as { text: string }).text;
    expect(message.length).toBeGreaterThan(0);

    const stillOpen = await db
      .select({ status: schema.timeRecord.status })
      .from(schema.timeRecord)
      .where(eq(schema.timeRecord.id, recordId));
    expect(stillOpen[0]?.status).toBe('open');

    // The same call succeeds the moment the work has a name again.
    await db
      .update(schema.timeRecord)
      .set({ title: 'Named at last' })
      .where(eq(schema.timeRecord.id, recordId));
    const stopped = payload(await track(client, { action: 'stop' }));
    expect(stopped.tracking.state).toBe('idle');
  });

  it('refuses to act on any timer for an agent principal', async () => {
    const s = await seedOrg();
    const agentCtx: McpContext = {
      principal: {
        kind: 'agent',
        agentId: 'agent_1',
        agentActorId: s.actorId,
        orgId: s.orgId,
        displayName: 'Athena',
      },
      scopes: ['work:read', 'work:write'],
    };
    const client = await connect(agentCtx);
    const refused = await track(client, { action: 'status' });
    expect(refused.isError).toBe(true);
  });
});
