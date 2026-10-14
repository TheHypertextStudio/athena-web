import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { eq } from 'drizzle-orm';
import { assertDefined } from '@docket/test-utils';
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '@docket/db';
import type { registerWorkloadTool as RegisterWorkload } from '../../src/mcp/workload-tool';
import type { registerApps as RegisterApps } from '../../src/mcp/apps';
import type { McpContext } from '../../src/mcp/auth';
import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import type { WorkloadSnapshot } from '../../src/workload/calculations';
import { acceptDailyDraft } from '@docket/planning/daily-plan-flow';

let schema: typeof DbModule;
let db: typeof DbModule.db;
let register: typeof RegisterWorkload;
let registerApps: typeof RegisterApps;
const connections: (() => Promise<void>)[] = [];
beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  register = (await import('../../src/mcp/workload-tool')).registerWorkloadTool;
  registerApps = (await import('../../src/mcp/apps')).registerApps;
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T09:30:00Z'));
});
afterEach(async () => {
  vi.useRealTimers();
  resetAuthMocks();
  await Promise.all(connections.splice(0).map((close) => close()));
});
async function connect(ctx: McpContext): Promise<Client> {
  const server = new McpServer(
    { name: 'workload-test', version: '1' },
    { capabilities: { tools: {}, resources: {} } },
  );
  register(server, ctx);
  registerApps(server);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  connections.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}
async function seed() {
  const slug = 'workload-' + Math.random().toString(36).slice(2, 10);
  const org = assertDefined(
    (
      await db
        .insert(schema.organization)
        .values({ name: 'Workload test workspace', slug, lifecycleState: 'active' })
        .returning()
    )[0],
  );
  const user = assertDefined(
    (
      await db
        .insert(schema.user)
        .values({ name: 'Workload test user', email: slug + '@example.com' })
        .returning()
    )[0],
  );
  const actor = assertDefined(
    (
      await db
        .insert(schema.actor)
        .values({ organizationId: org.id, kind: 'human', displayName: user.name, userId: user.id })
        .returning()
    )[0],
  );
  const hub = assertDefined(
    (await db.insert(schema.hub).values({ userId: user.id }).returning())[0],
  );
  const team = assertDefined(
    (
      await db
        .insert(schema.team)
        .values({ organizationId: org.id, name: 'Core', key: 'W' + slug.slice(-5) })
        .returning()
    )[0],
  );
  const seeded = await schema.seedWorkspaceStatuses(db, org.id);
  const statuses = (kind: 'task' | 'project', key: string): string =>
    assertDefined(seeded.get(schema.statusLookupKey(kind, key)));
  await db.insert(schema.grant).values({
    organizationId: org.id,
    subjectKind: 'actor',
    subjectId: actor.id,
    resourceKind: 'organization',
    resourceId: org.id,
    capabilities: ['view'],
    cascades: false,
  });
  const ctx: McpContext = {
    principal: { kind: 'user', userId: user.id, userName: user.name, userEmail: user.email },
    scopes: ['work:read'],
  };
  const input = { orgId: org.id, date: '2026-10-14', timezone: 'UTC', availableHours: 8 };
  const createTask = async (
    title: string,
    estimateMinutes: number | null,
    visibility: 'public' | 'private' = 'public',
  ) =>
    assertDefined(
      (
        await db
          .insert(schema.task)
          .values({
            organizationId: org.id,
            teamId: team.id,
            createdBy: actor.id,
            assigneeId: actor.id,
            title,
            estimateMinutes,
            visibility,
            state: 'backlog',
            statusId: statuses('task', 'backlog'),
            dueDate: new Date('2026-10-14T16:00Z'),
          })
          .returning()
      )[0],
    );
  const plan = async (
    taskId: string,
    start: string | null = null,
    end: string | null = null,
    status: 'planned' | 'done' = 'planned',
  ) =>
    db.insert(schema.dailyPlanItem).values({
      hubId: hub.id,
      refOrganizationId: org.id,
      refTaskId: taskId,
      date: input.date,
      status,
      timeboxStartsAt: start ? new Date(start) : null,
      timeboxEndsAt: end ? new Date(end) : null,
    });
  const track = async (
    taskId: string,
    start: string,
    end: string | null,
    mode: 'human_active' | 'tool_wait' = 'human_active',
  ) => {
    const record = assertDefined(
      (
        await db
          .insert(schema.timeRecord)
          .values({
            hubId: hub.id,
            createdByUserId: user.id,
            taskId,
            title: 'Task record',
            status: end ? 'closed' : 'open',
          })
          .returning()
      )[0],
    );
    const interval = assertDefined(
      (
        await db
          .insert(schema.timeInterval)
          .values({
            timeRecordId: record.id,
            hubId: hub.id,
            userId: user.id,
            taskId,
            actorKind: 'human',
            mode,
            source: 'manual_entry',
            startedAt: new Date(start),
            endedAt: end ? new Date(end) : null,
          })
          .returning()
      )[0],
    );
    return { record, interval };
  };
  return { org, user, actor, hub, ctx, input, createTask, plan, track, statuses };
}
function payload(result: CallToolResult) {
  expect(result.isError).not.toBe(true);
  return result.structuredContent as unknown as WorkloadSnapshot & {
    orgId: string;
    workspaceName: string;
  };
}
async function read(client: Client, input: Record<string, unknown>) {
  return (await client.callTool({ name: 'view_workload', arguments: input })) as CallToolResult;
}
function evidence(name: string, data: unknown) {
  const dir = process.env['WORKLOAD_EVIDENCE_DIR'];
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name + '.json'), JSON.stringify(data, null, 2));
}

describe('daily workload over the MCP wire', () => {
  it('advertises standard app metadata, read-only hints, and a self-contained resource', async () => {
    const s = await seed();
    const client = await connect(s.ctx);
    const tools = await client.listTools();
    const tool = assertDefined(tools.tools.find((t) => t.name === 'view_workload'));
    expect(tool._meta?.['ui']).toMatchObject({ resourceUri: 'ui://docket/workload' });
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    const resource = await client.readResource({ uri: 'ui://docket/workload' });
    const block = assertDefined(resource.contents[0]);
    expect(block.mimeType).toBe('text/html;profile=mcp-app');
    expect('text' in block ? block.text : '').not.toMatch(/(?:src|href)=["']https?:/);
    evidence('resource', resource);
    evidence('empty', payload(await read(client, s.input)));
  });
  it('calculates persisted data, hides private work, excludes waits, and remains read-only', async () => {
    const s = await seed();
    const a = await s.createTask('Prepare the launch brief', 180);
    const b = await s.createTask(
      'Review implementation details and acceptance evidence for the upcoming website release',
      null,
    );
    const launchProject = assertDefined(
      (
        await db
          .insert(schema.project)
          .values({
            organizationId: s.org.id,
            name: 'Website launch',
            createdBy: s.actor.id,
            statusId: s.statuses('project', 'planned'),
          })
          .returning()
      )[0],
    );
    await db
      .update(schema.task)
      .set({ projectId: launchProject.id })
      .where(eq(schema.task.id, a.id));
    const hidden = await s.createTask('SECRET PRIVATE TASK', 900, 'private');
    await s.plan(a.id, '2026-10-14T08:00Z', '2026-10-14T10:00Z');
    await s.plan(a.id, '2026-10-14T09:00Z', '2026-10-14T11:00Z');
    await s.plan(b.id, null, null, 'done');
    await s.plan(hidden.id);
    await s.track(a.id, '2026-10-14T00:00Z', '2026-10-14T01:30Z');
    await s.track(a.id, '2026-10-14T00:30Z', '2026-10-14T01:00Z');
    await s.track(a.id, '2026-10-14T01:30Z', '2026-10-14T02:00Z', 'tool_wait');
    await s.track(hidden.id, '2026-10-14T00:00Z', '2026-10-14T02:00Z');
    const client = await connect(s.ctx);
    const before = await db.select().from(schema.dailyPlanItem);
    const result = await read(client, s.input);
    const data = payload(result);
    expect(data.tasks.map((t) => t.title)).not.toContain(hidden.title);
    expect(JSON.stringify(result)).not.toContain(hidden.id);
    expect(data.totals).toMatchObject({
      plannedMinutes: 180,
      trackedMinutes: 90,
      missingEstimates: 1,
      untrackedCompleted: 1,
      overlapMinutes: 30,
      scheduleOverlapMinutes: 60,
    });
    expect(await db.select().from(schema.dailyPlanItem)).toEqual(before);
    expect(result.content.some((c) => c.type === 'text')).toBe(true);
    evidence('populated', data);
    evidence('overloaded', payload(await read(client, { ...s.input, availableHours: 1 })));
    evidence('zero-capacity', payload(await read(client, { ...s.input, availableHours: 0 })));
    evidence('previous', payload(await read(client, { ...s.input, date: '2026-10-13' })));
    evidence('next', payload(await read(client, { ...s.input, date: '2026-10-15' })));
    const pacific = payload(
      await read(client, { ...s.input, date: '2026-10-13', timezone: 'America/Los_Angeles' }),
    );
    expect(pacific.totals.trackedMinutes).toBe(90);
    evidence('pacific', pacific);
  });
  it.each(['America/Los_Angeles', 'Asia/Kathmandu'])(
    'classifies date-only assignments by their saved calendar day in %s',
    async (timezone) => {
      const s = await seed();
      const today = await s.createTask('Due on the selected day', 30);
      const tomorrow = await s.createTask('Due tomorrow', 60);
      await db
        .update(schema.task)
        .set({ dueDate: new Date('2026-10-14') })
        .where(eq(schema.task.id, today.id));
      await db
        .update(schema.task)
        .set({ dueDate: new Date('2026-10-15') })
        .where(eq(schema.task.id, tomorrow.id));
      const data = payload(await read(await connect(s.ctx), { ...s.input, timezone }));
      expect(data.tasks.map((task) => task.id)).toEqual([today.id]);
      expect(data.totals.plannedMinutes).toBe(30);
    },
  );
  it('uses every accepted allocation rather than the lossy first-session projection', async () => {
    const s = await seed();
    const a = await s.createTask('Split work', null);
    const b = await s.createTask('Shared work', null);
    const hidden = await s.createTask('HIDDEN ACCEPTED WORK', null, 'private');
    await s.plan(a.id, '2026-10-14T08:00Z', '2026-10-14T09:00Z');
    await s.plan(b.id, '2026-10-14T08:00Z', '2026-10-14T09:00Z');
    await db.update(schema.task).set({ dueDate: null }).where(eq(schema.task.id, b.id));
    const accepted = acceptDailyDraft(
      {
        date: s.input.date,
        mainTaskId: null,
        finishAt: '2026-10-14T17:00:00.000Z',
        tasks: [a, b, hidden].map((task, sort) => ({
          taskId: task.id,
          organizationId: s.org.id,
          sort,
          plannedMinutes: task.id === a.id ? 90 : 30,
        })),
        sessions: [
          {
            id: 'shared',
            startsAt: '2026-10-14T08:00:00.000Z',
            endsAt: '2026-10-14T09:00:00.000Z',
            pinned: false,
            allocations: [
              { taskId: a.id, plannedMinutes: 30 },
              { taskId: b.id, plannedMinutes: 30 },
            ],
          },
          {
            id: 'later',
            startsAt: '2026-10-14T10:00:00.000Z',
            endsAt: '2026-10-14T11:00:00.000Z',
            pinned: false,
            allocations: [{ taskId: a.id, plannedMinutes: 60 }],
          },
          {
            id: 'private',
            startsAt: '2026-10-14T11:00:00.000Z',
            endsAt: '2026-10-14T11:30:00.000Z',
            pinned: false,
            allocations: [{ taskId: hidden.id, plannedMinutes: 30 }],
          },
        ],
      },
      '2026-10-14T07:00:00.000Z',
    );
    await db.insert(schema.dailyPlanDay).values({ hubId: s.hub.id, date: s.input.date, accepted });
    const data = payload(await read(await connect(s.ctx), s.input));
    expect(data.tasks.find((task) => task.id === a.id)?.plannedMinutes).toBe(90);
    expect(data.tasks.find((task) => task.id === b.id)?.plannedMinutes).toBe(30);
    expect(data.totals).toMatchObject({
      plannedMinutes: 120,
      scheduledMinutes: 120,
      scheduleOverlapMinutes: 0,
    });
    expect(JSON.stringify(data)).not.toContain(hidden.id);
    expect(JSON.stringify(data)).not.toContain(hidden.title);
  });
  it('keeps a timeboxed task’s missing estimate visible over the wire', async () => {
    const s = await seed();
    const task = await s.createTask('Explore the next project milestone', null);
    await s.plan(task.id, '2026-10-14T13:00Z', '2026-10-14T15:00Z');
    const data = payload(await read(await connect(s.ctx), s.input));
    expect(data.totals).toMatchObject({
      plannedMinutes: 120,
      missingEstimates: 1,
      unknownDurations: 0,
    });
    evidence('timeboxed-no-estimate', data);
  });
  it('includes completed assignments, excludes undated backlog, and caps live timers at the server snapshot', async () => {
    const s = await seed();
    const done = await s.createTask('Completed assigned work', 60);
    await db
      .update(schema.task)
      .set({ completedAt: new Date('2026-10-14T00:00Z') })
      .where(eq(schema.task.id, done.id));
    const backlog = await s.createTask('Undated backlog', 90);
    await db.update(schema.task).set({ dueDate: null }).where(eq(schema.task.id, backlog.id));
    await s.track(done.id, '2026-10-14T00:00Z', null);
    const data = payload(await read(await connect(s.ctx), s.input));
    expect(data.tasks.map((t) => t.id)).toEqual([done.id]);
    expect(data.totals.plannedMinutes).toBe(60);
    const snapshotMinutes = (Date.parse(data.asOf) - Date.parse('2026-10-14T00:00Z')) / 60000;
    expect(data.totals.trackedMinutes).toBeCloseTo(Math.max(0, Math.min(1440, snapshotMinutes)), 6);
  });
  it('excludes superseded records and intervals, and foreign ledger authors', async () => {
    const s = await seed();
    const other = await seed();
    const a = await s.createTask('Current work', 60);
    const superseded = await s.track(a.id, '2026-10-14T00:00Z', '2026-10-14T01:00Z');
    await db
      .update(schema.timeRecord)
      .set({ status: 'superseded' })
      .where(eq(schema.timeRecord.id, superseded.record.id));
    const replaced = await s.track(a.id, '2026-10-14T01:00Z', '2026-10-14T02:00Z');
    await db
      .update(schema.timeInterval)
      .set({ supersededById: 'replacement' })
      .where(eq(schema.timeInterval.id, replaced.interval.id));
    const foreign = await s.track(a.id, '2026-10-14T00:00Z', '2026-10-14T01:00Z');
    await db
      .update(schema.timeRecord)
      .set({ createdByUserId: other.user.id })
      .where(eq(schema.timeRecord.id, foreign.record.id));
    expect(payload(await read(await connect(s.ctx), s.input)).totals.trackedMinutes).toBe(0);
  });
  it('isolates tenants and scopes and ignores untrusted identity arguments', async () => {
    const owner = await seed();
    const other = await seed();
    const task = await owner.createTask('Owners task', 120);
    await owner.plan(task.id);
    expect((await read(await connect(other.ctx), owner.input)).isError).toBe(true);
    expect((await read(await connect({ ...owner.ctx, scopes: [] }), owner.input)).isError).toBe(
      true,
    );
    const data = payload(
      await read(await connect(owner.ctx), {
        ...owner.input,
        actorId: other.actor.id,
        userId: other.user.id,
      }),
    );
    expect(data.tasks.map((t) => t.id)).toEqual([task.id]);
  });
  it('redacts private project metadata even when a task is readable', async () => {
    const s = await seed();
    const hiddenProject = assertDefined(
      (
        await db
          .insert(schema.project)
          .values({
            organizationId: s.org.id,
            name: 'SECRET PROJECT',
            createdBy: s.actor.id,
            visibility: 'private',
            statusId: s.statuses('project', 'planned'),
          })
          .returning()
      )[0],
    );
    const visibleTask = await s.createTask('Readable task', 60);
    await db
      .update(schema.task)
      .set({ projectId: hiddenProject.id })
      .where(eq(schema.task.id, visibleTask.id));
    const data = payload(await read(await connect(s.ctx), s.input));
    expect(data.tasks[0]).toMatchObject({ projectId: null, projectTitle: 'Restricted project' });
    expect(JSON.stringify(data)).not.toContain(hiddenProject.id);
    expect(JSON.stringify(data)).not.toContain(hiddenProject.name);
  });
  it('validates dates, timezone and budget over the protocol', async () => {
    const s = await seed();
    const client = await connect(s.ctx);
    for (const invalid of [
      { date: '2026-02-30' },
      { timezone: 'Not/A_Zone' },
      { availableHours: -1 },
      { availableHours: 25 },
    ]) {
      expect((await read(client, { ...s.input, ...invalid })).isError).toBe(true);
    }
  });
  it('rejects an agent principal rather than impersonating a human ledger', async () => {
    const s = await seed();
    const agent = await connect({
      principal: {
        kind: 'agent',
        agentId: 'test-agent',
        agentActorId: s.actor.id,
        orgId: s.org.id,
        displayName: 'Test agent',
      },
      scopes: ['work:read'],
    });
    expect((await read(agent, s.input)).isError).toBe(true);
  });
});
