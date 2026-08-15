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
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type { McpContext } from '../../src/mcp/auth';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import { one, seedStatuses, type StatusIdLookup } from '../support/routes-harness';

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
  statusId: StatusIdLookup;
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
  const statusId = await seedStatuses(db, schema, orgId);
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
    statusId,
    ctx: {
      principal: { kind: 'user', userId: user!.id, userName: 'Ada', userEmail: email },
      scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
    },
  };
}

async function seedTask(
  s: Seed,
  title: string,
  visibility: 'public' | 'private' = 'public',
): Promise<string> {
  const [row] = await db
    .insert(schema.task)
    .values({
      organizationId: s.orgId,
      title,
      teamId: s.teamId,
      state: 'backlog',
      statusId: s.statusId('task', 'backlog'),
      createdBy: s.actorId,
      visibility,
    })
    .returning({ id: schema.task.id });
  return row!.id;
}

/** Grant the caller one explicit capability at the resource under test. */
async function grantCapability(
  s: Seed,
  resourceKind: 'organization' | 'team' | 'task',
  resourceId: string,
  capabilities: readonly ('view' | 'contribute')[],
): Promise<string> {
  const [row] = await db
    .insert(schema.grant)
    .values({
      organizationId: s.orgId,
      subjectKind: 'actor',
      subjectId: s.actorId,
      resourceKind,
      resourceId,
      capabilities: [...capabilities],
      effect: 'allow',
      cascades: resourceKind === 'organization',
    })
    .returning({ id: schema.grant.id });
  if (!row) throw new Error('grant insert returned no row');
  return row.id;
}

/** Return all side effects a denied timer action must leave untouched. */
async function timerArtifacts(s: Seed): Promise<{
  readonly records: number;
  readonly intervals: number;
  readonly events: number;
  readonly tasks: number;
}> {
  const [records, intervals, events, tasks] = await Promise.all([
    db
      .select({ id: schema.timeRecord.id })
      .from(schema.timeRecord)
      .where(eq(schema.timeRecord.createdByUserId, s.userId)),
    db
      .select({ id: schema.timeInterval.id })
      .from(schema.timeInterval)
      .where(eq(schema.timeInterval.userId, s.userId)),
    db
      .select({ id: schema.event.id })
      .from(schema.event)
      .where(and(eq(schema.event.userId, s.userId), eq(schema.event.organizationId, s.orgId))),
    db
      .select({ id: schema.task.id })
      .from(schema.task)
      .where(eq(schema.task.organizationId, s.orgId)),
  ]);
  return {
    records: records.length,
    intervals: intervals.length,
    events: events.length,
    tasks: tasks.length,
  };
}

/** Give the seeded active member the canonical Guest role, with no implicit task access. */
async function makeGuest(s: Seed): Promise<void> {
  const [guest] = await db
    .insert(schema.role)
    .values({
      organizationId: s.orgId,
      key: 'guest',
      name: 'Guest',
      defaultVisibility: 'private',
    })
    .returning({ id: schema.role.id });
  if (!guest) throw new Error('guest role insert returned no row');
  await db.update(schema.actor).set({ roleId: guest.id }).where(eq(schema.actor.id, s.actorId));
}

/** Assert an MCP denial hides the target rather than echoing the task identity. */
function expectHiddenTaskDenial(result: CallToolResult, taskId: string, title: string): void {
  expect(result.isError).toBe(true);
  const text = (result.content[0] as { text: string }).text;
  expect(text).toContain('not_found');
  expect(text).not.toContain(taskId);
  expect(text).not.toContain(title);
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
    await grantCapability(s, 'team', s.teamId, ['contribute']);
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

  // A bare `start` is the one-click start, not an omission: the person began before deciding what
  // to call it. Refusing here used to force an assistant to invent a name on their behalf, which
  // put words in the ledger that nobody said.
  it('starts an unnamed session when neither a task nor a label is given', async () => {
    const s = await seedOrg();
    await grantCapability(s, 'team', s.teamId, ['contribute']);
    const client = await connect(s.ctx);
    const started = payload(await track(client, { action: 'start' }));
    expect(started.tracking.state).toBe('running');
    expect(started.tracking.taskId).toBeNull();

    // It still cannot be *finished* nameless — that guard did not move.
    const refused = await track(client, { action: 'stop' });
    expect(refused.isError).toBe(true);

    const stopped = payload(await track(client, { action: 'stop', label: 'Untangle the deploy' }));
    expect(stopped.tracking.taskId).toEqual(expect.any(String));
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

  it('redacts a revoked private task from status and segments', async () => {
    const s = await seedOrg();
    const taskTitle = 'Board compensation review';
    const taskId = await seedTask(s, taskTitle, 'private');
    const grant = one(
      await db
        .insert(schema.grant)
        .values({
          organizationId: s.orgId,
          subjectKind: 'actor',
          subjectId: s.actorId,
          resourceKind: 'task',
          resourceId: taskId,
          capabilities: ['view'],
          effect: 'allow',
          cascades: false,
        })
        .returning({ id: schema.grant.id }),
    );
    const client = await connect(s.ctx);

    const started = payload(await track(client, { action: 'start', taskId }));
    expect(started.tracking).toMatchObject({ taskId, taskTitle });

    await db.delete(schema.grant).where(eq(schema.grant.id, grant.id));

    const status = payload(await track(client, { action: 'status' }));
    const segments = payload(
      await track(client, {
        action: 'segments',
        start: '2020-01-01T00:00:00.000Z',
        end: '2040-01-01T00:00:00.000Z',
      }),
    );
    expect(status.tracking).toMatchObject({ taskId: null, taskTitle: 'Restricted work' });
    expect(segments.segments).toEqual([
      expect.objectContaining({ taskId: null, taskTitle: 'Restricted work', running: true }),
    ]);

    const serialized = JSON.stringify({ status, segments });
    expect(serialized).not.toContain(taskId);
    expect(serialized).not.toContain(s.orgId);
    expect(serialized).not.toContain(taskTitle);
  });

  it('hides an unviewable task before MCP start writes timer or event artifacts', async () => {
    const s = await seedOrg();
    const taskTitle = 'Board compensation review';
    const taskId = await seedTask(s, taskTitle, 'private');
    const client = await connect(s.ctx);
    const before = await timerArtifacts(s);

    const denied = await track(client, { action: 'start', taskId });

    expectHiddenTaskDenial(denied, taskId, taskTitle);
    expect(await timerArtifacts(s)).toEqual(before);
  });

  it('hides an unviewable switch target without changing the active timer', async () => {
    const s = await seedOrg();
    const taskTitle = 'Executive succession plan';
    const taskId = await seedTask(s, taskTitle, 'private');
    const client = await connect(s.ctx);
    const current = payload(await track(client, { action: 'start' }));
    const before = await timerArtifacts(s);

    const denied = await track(client, { action: 'switch', taskId });

    expectHiddenTaskDenial(denied, taskId, taskTitle);
    expect(await timerArtifacts(s)).toEqual(before);
    expect(payload(await track(client, { action: 'status' })).tracking).toMatchObject({
      state: 'running',
      timeRecordId: current.tracking.timeRecordId,
      taskId: null,
    });
  });

  it('refuses to resume a private task after its direct view grant is revoked', async () => {
    const s = await seedOrg();
    const taskTitle = 'Compensation deliberation';
    const taskId = await seedTask(s, taskTitle, 'private');
    const grantId = await grantCapability(s, 'task', taskId, ['view']);
    const client = await connect(s.ctx);
    const started = payload(await track(client, { action: 'start', taskId }));
    const paused = payload(
      await track(client, { action: 'pause', timeRecordId: started.tracking.timeRecordId }),
    );
    expect(paused.tracking.state).toBe('paused');
    await db.delete(schema.grant).where(eq(schema.grant.id, grantId));
    const before = await timerArtifacts(s);

    const denied = await track(client, {
      action: 'resume',
      timeRecordId: started.tracking.timeRecordId,
    });

    expectHiddenTaskDenial(denied, taskId, taskTitle);
    expect(await timerArtifacts(s)).toEqual(before);
    const [record] = await db
      .select({ status: schema.timeRecord.status })
      .from(schema.timeRecord)
      .where(eq(schema.timeRecord.id, started.tracking.timeRecordId!));
    expect(record?.status).toBe('paused');
  });

  it('does not create label work for a Guest, including when an unnamed timer is stopped', async () => {
    const s = await seedOrg();
    await makeGuest(s);
    const client = await connect(s.ctx);
    const beforeStart = await timerArtifacts(s);

    const deniedStart = await track(client, {
      action: 'start',
      label: 'Prepare the board packet',
      orgId: s.orgId,
    });

    expect(deniedStart.isError).toBe(true);
    expect((deniedStart.content[0] as { text: string }).text).toContain('forbidden');
    expect(await timerArtifacts(s)).toEqual(beforeStart);

    const unnamed = payload(await track(client, { action: 'start' }));
    const beforeStop = await timerArtifacts(s);
    const deniedStop = await track(client, {
      action: 'stop',
      timeRecordId: unnamed.tracking.timeRecordId,
      label: 'Still not allowed to create this',
    });

    expect(deniedStop.isError).toBe(true);
    expect((deniedStop.content[0] as { text: string }).text).toContain('forbidden');
    expect(await timerArtifacts(s)).toEqual(beforeStop);
    const [record] = await db
      .select({ status: schema.timeRecord.status, taskId: schema.timeRecord.taskId })
      .from(schema.timeRecord)
      .where(eq(schema.timeRecord.id, unnamed.tracking.timeRecordId!));
    expect(record).toMatchObject({ status: 'open', taskId: null });
  });

  it('does not create label work for an archived actor', async () => {
    const s = await seedOrg();
    await db
      .update(schema.actor)
      .set({ archivedAt: new Date() })
      .where(eq(schema.actor.id, s.actorId));
    const client = await connect(s.ctx);
    const before = await timerArtifacts(s);

    const denied = await track(client, {
      action: 'start',
      label: 'Archived member task',
      orgId: s.orgId,
    });

    expect(denied.isError).toBe(true);
    expect((denied.content[0] as { text: string }).text).toContain('not_found');
    expect(await timerArtifacts(s)).toEqual(before);
  });

  it('reports a visible landing team without contribute as forbidden and leaves no artifacts', async () => {
    const s = await seedOrg();
    await grantCapability(s, 'team', s.teamId, ['view']);
    const client = await connect(s.ctx);
    const before = await timerArtifacts(s);

    const denied = await track(client, {
      action: 'start',
      label: 'Needs write access',
      orgId: s.orgId,
    });

    expect(denied.isError).toBe(true);
    expect((denied.content[0] as { text: string }).text).toContain('forbidden');
    expect(await timerArtifacts(s)).toEqual(before);
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
