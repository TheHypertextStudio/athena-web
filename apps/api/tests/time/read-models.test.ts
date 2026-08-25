/**
 * `@docket/api` — direct unit coverage for `time/read-models.ts`.
 *
 * @remarks
 * The route-level Time Ledger tests (`routes/time.test.ts`, `routes/time-edge-cases.test.ts`)
 * exercise the happy paths end to end. This file drives the exported measure/read functions
 * directly so the fallback and grouping branches a normal timer session never exercises — an
 * empty interval set, a clipped-out-of-range interval, `agent_active`/`tool_wait` effort, the
 * `category`/`actor`/`capture_source` breakdown groupings, a multi-initiative project — are each covered by a
 * real, targeted fixture.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';

import type * as DbModule from '@docket/db';
import { TimeTimelineQuery, type TimeRecordOut } from '@docket/types';

import {
  getDb,
  one,
  seedBaseOrg,
  seedUserWithHub,
  type StatusIdLookup,
} from '../support/routes-harness';
import {
  getActiveTime,
  getTimeBreakdown,
  getTimeSummary,
  getTimeTimeline,
  hydrateTimeRecords,
  listTimeCategories,
  measureIntervals,
  measureRecordInRange,
} from '../../src/time/read-models';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

type TimeIntervalRow = typeof DbModule.timeInterval.$inferSelect;
type TimeRecordRow = typeof DbModule.timeRecord.$inferSelect;
/** The pre-brand wire shape `measureRecordInRange`/`hydrateTimeRecords` actually take. */
type TimeRecordInput = z.input<typeof TimeRecordOut>;
type IntervalIn = TimeRecordInput['intervals'][number];

/** A minimal, otherwise-valid interval row (DB-shaped, `Date` timestamps), overridable. */
function intervalRow(over: Partial<TimeIntervalRow> = {}): TimeIntervalRow {
  return {
    id: 'ti_1',
    timeRecordId: 'tr_1',
    hubId: 'hub_1',
    taskId: 'task_1',
    actorKind: 'human',
    userId: 'user_1',
    agentExecutionId: null,
    mode: 'human_active',
    source: 'user_timer',
    startedAt: new Date('2026-07-01T09:00:00Z'),
    endedAt: new Date('2026-07-01T09:30:00Z'),
    supersededById: null,
    createdAt: new Date('2026-07-01T09:00:00Z'),
    closedAt: null,
    ...over,
  };
}

/** A minimal, otherwise-valid serialized interval (string timestamps), overridable. */
function intervalIn(over: Partial<IntervalIn> = {}): IntervalIn {
  return {
    id: 'ti_1',
    timeRecordId: 'tr_1',
    taskId: 'task_1',
    actorKind: 'human',
    userId: 'user_1',
    agentExecutionId: null,
    mode: 'human_active',
    source: 'user_timer',
    startedAt: '2026-07-01T09:00:00.000Z',
    endedAt: '2026-07-01T09:30:00.000Z',
    supersededById: null,
    createdAt: '2026-07-01T09:00:00.000Z',
    closedAt: null,
    ...over,
  };
}

describe('measureIntervals', () => {
  it('returns zeroed measures for an empty interval set', () => {
    expect(measureIntervals([], new Date())).toEqual({
      elapsedMs: 0,
      humanEffortMs: 0,
      agentEffortMs: 0,
      combinedEffortMs: 0,
      operationalWaitMs: 0,
    });
  });

  it('sums agent effort and operational-wait modes, ignoring a superseded interval', () => {
    const now = new Date('2026-07-01T12:00:00Z');
    const measures = measureIntervals(
      [
        intervalRow({
          mode: 'agent_active',
          startedAt: new Date('2026-07-01T09:00:00Z'),
          endedAt: new Date('2026-07-01T09:10:00Z'),
        }),
        intervalRow({
          mode: 'tool_wait',
          startedAt: new Date('2026-07-01T09:10:00Z'),
          endedAt: new Date('2026-07-01T09:15:00Z'),
        }),
        intervalRow({
          mode: 'awaiting_human',
          startedAt: new Date('2026-07-01T09:15:00Z'),
          endedAt: new Date('2026-07-01T09:20:00Z'),
        }),
        // Superseded — excluded entirely, even though it would otherwise widen the span.
        intervalRow({
          mode: 'human_active',
          startedAt: new Date('2026-06-01T00:00:00Z'),
          endedAt: new Date('2026-06-01T01:00:00Z'),
          supersededById: 'ti_newer',
        }),
      ],
      now,
    );
    expect(measures.agentEffortMs).toBe(10 * 60_000);
    expect(measures.operationalWaitMs).toBe(10 * 60_000);
    expect(measures.elapsedMs).toBe(20 * 60_000); // 09:00–09:20, not touching the superseded one
  });
});

describe('measureRecordInRange', () => {
  const record: TimeRecordInput = {
    id: 'tr_1',
    hubId: 'hub_1',
    taskId: 'task_1',
    organizationId: null,
    title: 'Session',
    outcomeNote: null,
    status: 'closed',
    categoryId: null,
    captureSource: 'live',
    startedAt: '2026-07-01T09:00:00.000Z',
    endedAt: '2026-07-01T10:00:00.000Z',
    createdAt: '2026-07-01T09:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    closedAt: '2026-07-01T10:00:00.000Z',
    intervals: [],
    contexts: [],
    allocations: [],
    measures: {
      elapsedMs: 0,
      humanEffortMs: 0,
      agentEffortMs: 0,
      combinedEffortMs: 0,
      operationalWaitMs: 0,
    },
  };
  const now = new Date('2026-07-02T00:00:00Z');

  it('returns zeroed measures when every interval is superseded or clipped out of the range', () => {
    const outOfRange = measureRecordInRange(
      {
        ...record,
        intervals: [
          intervalIn({
            startedAt: '2026-01-01T09:00:00.000Z',
            endedAt: '2026-01-01T10:00:00.000Z',
          }),
          intervalIn({ supersededById: 'ti_newer' }),
        ],
      },
      new Date('2026-07-01T00:00:00Z'),
      new Date('2026-07-02T00:00:00Z'),
      now,
    );
    expect(outOfRange).toEqual({
      elapsedMs: 0,
      humanEffortMs: 0,
      agentEffortMs: 0,
      combinedEffortMs: 0,
      operationalWaitMs: 0,
    });
  });

  it('clips a partially-overlapping interval and sums agent/wait modes across the rest', () => {
    const measures = measureRecordInRange(
      {
        ...record,
        intervals: [
          // Starts before the range, ends inside it — clipped to the range start.
          intervalIn({
            id: 'ti_clip',
            startedAt: '2026-06-30T23:00:00.000Z',
            endedAt: '2026-07-01T00:30:00.000Z',
          }),
          intervalIn({
            id: 'ti_agent',
            mode: 'agent_active',
            startedAt: '2026-07-01T01:00:00.000Z',
            endedAt: '2026-07-01T01:10:00.000Z',
          }),
          intervalIn({
            id: 'ti_wait',
            mode: 'tool_wait',
            startedAt: '2026-07-01T01:10:00.000Z',
            endedAt: '2026-07-01T01:20:00.000Z',
          }),
        ],
      },
      new Date('2026-07-01T00:00:00Z'),
      new Date('2026-07-02T00:00:00Z'),
      now,
    );
    expect(measures.humanEffortMs).toBe(30 * 60_000); // clipped to 00:00–00:30
    expect(measures.agentEffortMs).toBe(10 * 60_000);
    expect(measures.operationalWaitMs).toBe(10 * 60_000);
  });
});

describe('hydrateTimeRecords', () => {
  it('falls back to empty relation arrays and a null organization for an unmatched task', async () => {
    const bare: TimeRecordRow = {
      id: 'tr_bare',
      hubId: 'hub_bare',
      createdByUserId: 'user_bare',
      taskId: 'task_does_not_exist',
      title: 'Untethered',
      outcomeNote: null,
      status: 'open',
      categoryId: null,
      captureSource: 'live',
      startedAt: null,
      endedAt: null,
      closedAt: null,
      supersededById: null,
      createdAt: new Date('2026-07-01T09:00:00Z'),
      updatedAt: new Date('2026-07-01T09:00:00Z'),
    };
    const [hydrated] = await hydrateTimeRecords([bare], 'user_bare', new Date());
    expect(hydrated).toMatchObject({
      organizationId: null,
      startedAt: null,
      endedAt: null,
      closedAt: null,
      intervals: [],
      contexts: [],
      allocations: [],
    });
  });

  it('returns an empty array for an empty record set', async () => {
    expect(await hydrateTimeRecords([], 'user_x', new Date())).toEqual([]);
  });
});

describe('getActiveTime', () => {
  /** Seed a user, org, team, and task ready to track time against. */
  async function seedTrackable(label: string) {
    const { orgId, teamId, statusId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, label);
    const [hubRow] = await db
      .select({ id: schema.hub.id })
      .from(schema.hub)
      .where(eq(schema.hub.userId, userId))
      .limit(1);
    const taskId = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Tracked task',
          state: 'todo',
          statusId: statusId('task', 'todo'),
        })
        .returning({ id: schema.task.id }),
    ).id;
    return { userId, hubId: assertDefined(hubRow).id, taskId };
  }

  /**
   * Insert a Time Record plus its one `human_active` interval, with explicit control over
   * `status`, whether the interval is closed, and `updatedAt` — so tie-break ordering can be
   * seeded deterministically instead of relying on real-clock timing between inserts.
   */
  async function seedRecord(
    hubId: string,
    userId: string,
    taskId: string,
    fields: { status: 'open' | 'paused'; intervalEndedAt: Date | null; updatedAt: Date },
  ): Promise<string> {
    const startedAt = new Date('2026-07-01T09:00:00Z');
    const record = one(
      await db
        .insert(schema.timeRecord)
        .values({
          hubId,
          createdByUserId: userId,
          taskId,
          title: 'Session',
          status: fields.status,
          startedAt,
          endedAt: fields.intervalEndedAt,
          updatedAt: fields.updatedAt,
        })
        .returning({ id: schema.timeRecord.id }),
    );
    await db.insert(schema.timeInterval).values({
      timeRecordId: record.id,
      hubId,
      taskId,
      actorKind: 'human',
      userId,
      mode: 'human_active',
      source: 'user_timer',
      startedAt,
      endedAt: fields.intervalEndedAt,
      closedAt: fields.intervalEndedAt,
    });
    return record.id;
  }

  it('returns a paused record (closed interval, no open tracker) with measures for that interval', async () => {
    const { userId, hubId, taskId } = await seedTrackable('ActivePaused');
    const recordId = await seedRecord(hubId, userId, taskId, {
      status: 'paused',
      intervalEndedAt: new Date('2026-07-01T09:30:00Z'),
      updatedAt: new Date('2026-07-01T09:30:00Z'),
    });

    const active = await getActiveTime(userId);
    expect(active.record?.id).toBe(recordId);
    expect(active.record?.status).toBe('paused');
    expect(active.record?.measures.humanEffortMs).toBe(30 * 60_000);
    expect(active.record?.measures.elapsedMs).toBe(30 * 60_000);
  });

  it('breaks a tie between multiple paused records by the most recently updated one', async () => {
    const { userId, hubId, taskId } = await seedTrackable('ActiveMultiPaused');
    // Abandoned long ago and never touched again by `closeOpenHumanSegments` (it only pauses
    // whichever record currently holds the open interval), so it is still 'paused' — but it is
    // not the one the caller most recently paused.
    await seedRecord(hubId, userId, taskId, {
      status: 'paused',
      intervalEndedAt: new Date('2026-06-01T09:30:00Z'),
      updatedAt: new Date('2026-06-01T09:30:00Z'),
    });
    const recentlyPausedId = await seedRecord(hubId, userId, taskId, {
      status: 'paused',
      intervalEndedAt: new Date('2026-07-01T09:30:00Z'),
      updatedAt: new Date('2026-07-01T09:30:00Z'),
    });

    const active = await getActiveTime(userId);
    expect(active.record?.id).toBe(recentlyPausedId);
  });

  it('prefers an open record over any paused record, even one updated more recently', async () => {
    const { userId, hubId, taskId } = await seedTrackable('ActiveOpenBeatsPaused');
    const openId = await seedRecord(hubId, userId, taskId, {
      status: 'open',
      intervalEndedAt: null,
      updatedAt: new Date('2026-01-01T09:00:00Z'),
    });
    await seedRecord(hubId, userId, taskId, {
      status: 'paused',
      intervalEndedAt: new Date('2026-07-01T09:30:00Z'),
      updatedAt: new Date('2026-07-01T09:30:00Z'),
    });

    const active = await getActiveTime(userId);
    expect(active.record?.id).toBe(openId);
    expect(active.record?.status).toBe('open');
  });

  it('reports queued/running agent executions for the user, resolving a null startedAt', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'ActiveExecUser');
    const agentActor = one(
      await db
        .insert(schema.actor)
        .values({ organizationId: orgId, kind: 'agent', displayName: 'Athena' })
        .returning({ id: schema.actor.id }),
    );
    const agent = one(
      await db
        .insert(schema.agent)
        .values({ organizationId: orgId, actorId: agentActor.id })
        .returning({ id: schema.agent.id }),
    );
    // A session may have at most one OPEN (endedAt IS NULL) execution, so each execution below
    // gets its own session.
    async function seedSession(): Promise<string> {
      return one(
        await db
          .insert(schema.agentSession)
          .values({
            organizationId: orgId,
            agentId: agent.id,
            initiatorId: humanActorId,
            trigger: 'delegation',
            status: 'running',
          })
          .returning({ id: schema.agentSession.id }),
      ).id;
    }
    // Queued: no startedAt yet.
    await db.insert(schema.agentExecution).values({
      sessionId: await seedSession(),
      initiatedByUserId: userId,
      status: 'queued',
    });
    // Running: startedAt resolves to an ISO string.
    await db.insert(schema.agentExecution).values({
      sessionId: await seedSession(),
      initiatedByUserId: userId,
      status: 'running',
      startedAt: new Date('2026-07-01T09:00:00Z'),
    });
    // Terminal — excluded by the status filter.
    await db.insert(schema.agentExecution).values({
      sessionId: await seedSession(),
      initiatedByUserId: userId,
      status: 'completed',
      startedAt: new Date('2026-07-01T08:00:00Z'),
      endedAt: new Date('2026-07-01T08:30:00Z'),
    });

    const active = await getActiveTime(userId);
    expect(active.record).toBeNull();
    expect(active.activeAgentExecutions).toHaveLength(2);
    const byStatus = new Map(active.activeAgentExecutions.map((e) => [e.status, e]));
    expect(byStatus.get('queued')?.startedAt).toBeNull();
    expect(byStatus.get('running')?.startedAt).toBe('2026-07-01T09:00:00.000Z');
  });
});

describe('getTimeTimeline', () => {
  it('returns an empty array when nothing overlaps the requested range', async () => {
    const userId = await seedUserWithHub(db, schema, 'TimelineEmpty');
    const timeline = await getTimeTimeline(userId, {
      start: '2020-01-01T00:00:00.000Z',
      end: '2020-01-02T00:00:00.000Z',
    });
    expect(timeline).toEqual([]);
  });
});

describe('getTimeSummary', () => {
  /** Seed a user, org, team, and task ready to track time against. */
  async function seedTrackable(label: string) {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, label);
    await db.update(schema.actor).set({ userId }).where(eq(schema.actor.id, humanActorId));
    const [hubRow] = await db
      .select({ id: schema.hub.id })
      .from(schema.hub)
      .where(eq(schema.hub.userId, userId))
      .limit(1);
    const t = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Tracked task',
          state: 'todo',
          statusId: statusId('task', 'todo'),
        })
        .returning({ id: schema.task.id }),
    );
    return {
      orgId,
      teamId,
      humanActorId,
      statusId,
      userId,
      hubId: assertDefined(hubRow).id,
      taskId: t.id,
    };
  }

  /** Insert a time record with one interval, returning both ids. */
  async function seedRecordWithInterval(
    hubId: string,
    userId: string,
    taskId: string,
    fields: {
      mode?: 'human_active' | 'agent_active' | 'tool_wait' | 'awaiting_human';
      startedAt: Date;
      endedAt: Date | null;
      status?: 'open' | 'closed' | 'submitted';
      categoryId?: string | null;
      captureSource?: 'live' | 'manual' | 'reconstructed' | 'agent';
    },
  ): Promise<{ recordId: string }> {
    const record = one(
      await db
        .insert(schema.timeRecord)
        .values({
          hubId,
          createdByUserId: userId,
          taskId,
          title: 'Session',
          status: fields.status ?? 'closed',
          startedAt: fields.startedAt,
          endedAt: fields.endedAt,
          categoryId: fields.categoryId ?? null,
          captureSource: fields.captureSource ?? 'live',
        })
        .returning({ id: schema.timeRecord.id }),
    );
    await db.insert(schema.timeInterval).values({
      timeRecordId: record.id,
      hubId,
      taskId,
      actorKind: fields.mode === 'agent_active' ? 'agent' : 'human',
      userId,
      mode: fields.mode ?? 'human_active',
      source: fields.captureSource === 'manual' ? 'manual_entry' : 'user_timer',
      startedAt: fields.startedAt,
      endedAt: fields.endedAt,
    });
    return { recordId: record.id };
  }

  it('sums agent effort and operational-wait modes across the range', async () => {
    const { hubId, userId, taskId } = await seedTrackable('SummaryModes');
    await seedRecordWithInterval(hubId, userId, taskId, {
      mode: 'agent_active',
      startedAt: new Date('2026-07-05T09:00:00Z'),
      endedAt: new Date('2026-07-05T09:10:00Z'),
    });
    await seedRecordWithInterval(hubId, userId, taskId, {
      mode: 'tool_wait',
      startedAt: new Date('2026-07-05T09:10:00Z'),
      endedAt: new Date('2026-07-05T09:20:00Z'),
    });
    await seedRecordWithInterval(hubId, userId, taskId, {
      mode: 'awaiting_human',
      startedAt: new Date('2026-07-05T09:20:00Z'),
      endedAt: new Date('2026-07-05T09:25:00Z'),
    });
    const summary = await getTimeSummary(userId, {
      start: '2026-07-05T00:00:00.000Z',
      end: '2026-07-06T00:00:00.000Z',
    });
    expect(summary.agentEffortMs).toBe(10 * 60_000);
    expect(summary.operationalWaitMs).toBe(15 * 60_000);
  });

  it('excludes a currently-open interval whose clip falls outside a future query range', async () => {
    const { hubId, userId, taskId } = await seedTrackable('SummaryFutureRange');
    // Started in the past and still open — SQL's `isNull(endedAt)` always matches it, but
    // clipping to a future range (using `now` as its effective end) yields nothing.
    await seedRecordWithInterval(hubId, userId, taskId, {
      startedAt: new Date('2020-01-01T09:00:00Z'),
      endedAt: null,
      status: 'open',
    });
    const future = new Date(Date.now() + 30 * 86_400_000);
    const dayAfter = new Date(future.getTime() + 86_400_000);
    const summary = await getTimeSummary(userId, {
      start: future.toISOString(),
      end: dayAfter.toISOString(),
    });
    expect(summary).toEqual({
      elapsedMs: 0,
      humanEffortMs: 0,
      agentEffortMs: 0,
      combinedEffortMs: 0,
      operationalWaitMs: 0,
    });
  });

  it('applies the same personal filters before sessions, totals, and breakdowns', async () => {
    const { orgId, teamId, humanActorId, statusId, hubId, userId, taskId } =
      await seedTrackable('FilteredLedger');
    const [project] = await db
      .insert(schema.project)
      .values({
        organizationId: orgId,
        name: 'Ledger project',
        createdBy: humanActorId,
        status: 'planned',
        statusId: statusId('project', 'planned'),
      })
      .returning({ id: schema.project.id });
    const projectTask = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Project-only task',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          projectId: assertDefined(project).id,
        })
        .returning({ id: schema.task.id }),
    ).id;
    const category = one(
      await db
        .insert(schema.timeCategory)
        .values({ hubId, name: 'Deep work' })
        .returning({ id: schema.timeCategory.id }),
    ).id;
    await seedRecordWithInterval(hubId, userId, taskId, {
      startedAt: new Date('2026-07-05T09:00:00Z'),
      endedAt: new Date('2026-07-05T09:30:00Z'),
      categoryId: category,
      captureSource: 'manual',
    });
    await seedRecordWithInterval(hubId, userId, projectTask, {
      startedAt: new Date('2026-07-05T10:00:00Z'),
      endedAt: new Date('2026-07-05T10:20:00Z'),
    });

    const range = {
      start: '2026-07-05T00:00:00.000Z',
      end: '2026-07-06T00:00:00.000Z',
    };
    const filters = TimeTimelineQuery.parse({
      ...range,
      workspaceId: orgId,
      taskId,
      categoryId: category,
      captureSource: 'manual',
    });
    const [timeline, summary, breakdown] = await Promise.all([
      getTimeTimeline(userId, filters),
      getTimeSummary(userId, filters),
      getTimeBreakdown(userId, { ...filters, groupBy: 'task' }),
    ]);

    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.taskId).toBe(taskId);
    expect(summary.humanEffortMs).toBe(30 * 60_000);
    expect(breakdown.total.humanEffortMs).toBe(30 * 60_000);
    expect(breakdown.buckets).toMatchObject([{ key: taskId }]);

    const projectTimeline = await getTimeTimeline(userId, {
      ...range,
      projectId: assertDefined(project).id,
    });
    expect(projectTimeline).toHaveLength(1);
    expect(projectTimeline[0]?.taskId).toBe(projectTask);
  });
});

describe('listTimeCategories', () => {
  it('lists a Hub’s categories ordered by sort then name', async () => {
    const userId = await seedUserWithHub(db, schema, 'CategoryLister');
    const [hubRow] = await db
      .select({ id: schema.hub.id })
      .from(schema.hub)
      .where(eq(schema.hub.userId, userId))
      .limit(1);
    const hubId = assertDefined(hubRow).id;
    await db.insert(schema.timeCategory).values([
      { hubId, name: 'Zeta', sort: 0 },
      { hubId, name: 'Alpha', sort: 0 },
      { hubId, name: 'First', sort: -1 },
    ]);
    const categories = await listTimeCategories(userId);
    expect(categories.map((c) => c.name)).toEqual(['First', 'Alpha', 'Zeta']);
  });
});

describe('getTimeBreakdown', () => {
  /** Seed a user, org, team, and task ready to track time against. */
  async function seedTrackable(label: string) {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, label);
    await db.update(schema.actor).set({ userId }).where(eq(schema.actor.id, humanActorId));
    const [hubRow] = await db
      .select({ id: schema.hub.id })
      .from(schema.hub)
      .where(eq(schema.hub.userId, userId))
      .limit(1);
    return { orgId, teamId, humanActorId, userId, hubId: assertDefined(hubRow).id, statusId };
  }

  async function seedTask(statusId: StatusIdLookup, orgId: string, teamId: string, title = 'Task') {
    return one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title,
          state: 'todo',
          statusId: statusId('task', 'todo'),
        })
        .returning({ id: schema.task.id }),
    ).id;
  }

  async function seedRecordWithInterval(
    hubId: string,
    userId: string,
    taskId: string,
    fields: {
      mode?: 'human_active' | 'agent_active' | 'tool_wait';
      startedAt: Date;
      endedAt: Date;
      categoryId?: string | null;
      captureSource?: 'live' | 'manual' | 'reconstructed' | 'agent';
    },
  ): Promise<void> {
    const record = one(
      await db
        .insert(schema.timeRecord)
        .values({
          hubId,
          createdByUserId: userId,
          taskId,
          title: 'Session',
          status: 'closed',
          startedAt: fields.startedAt,
          endedAt: fields.endedAt,
          categoryId: fields.categoryId ?? null,
          captureSource: fields.captureSource ?? 'live',
        })
        .returning({ id: schema.timeRecord.id }),
    );
    await db.insert(schema.timeInterval).values({
      timeRecordId: record.id,
      hubId,
      taskId,
      actorKind: fields.mode === 'agent_active' ? 'agent' : 'human',
      userId,
      mode: fields.mode ?? 'human_active',
      source: fields.captureSource === 'manual' ? 'manual_entry' : 'user_timer',
      startedAt: fields.startedAt,
      endedAt: fields.endedAt,
    });
  }

  const RANGE = {
    start: '2026-08-01T00:00:00.000Z',
    end: '2026-08-02T00:00:00.000Z',
  };

  it('returns an empty bucket list (and short-circuits task placement) for an empty range', async () => {
    const { userId } = await seedTrackable('BreakdownEmpty');
    const breakdown = await getTimeBreakdown(userId, { ...RANGE, groupBy: 'project' });
    expect(breakdown.buckets).toEqual([]);
  });

  it('groups by category: a named category alongside uncategorized time', async () => {
    const { orgId, teamId, hubId, userId, statusId } = await seedTrackable('BreakdownCategory');
    const taskId = await seedTask(statusId, orgId, teamId);
    const category = one(
      await db
        .insert(schema.timeCategory)
        .values({ hubId, name: 'Deep work' })
        .returning({ id: schema.timeCategory.id }),
    );
    await seedRecordWithInterval(hubId, userId, taskId, {
      categoryId: category.id,
      startedAt: new Date('2026-08-01T09:00:00Z'),
      endedAt: new Date('2026-08-01T09:30:00Z'),
    });
    await seedRecordWithInterval(hubId, userId, taskId, {
      categoryId: null,
      startedAt: new Date('2026-08-01T10:00:00Z'),
      endedAt: new Date('2026-08-01T10:15:00Z'),
    });

    const breakdown = await getTimeBreakdown(userId, { ...RANGE, groupBy: 'category' });
    const labels = breakdown.buckets.map((b) => b.label).sort();
    expect(labels).toEqual(['Deep work', 'Uncategorized'].sort());
  });

  it('groups by actor: human-only, agent-only (with wait time), and both', async () => {
    const { orgId, teamId, hubId, userId, statusId } = await seedTrackable('BreakdownActor');
    const taskId = await seedTask(statusId, orgId, teamId);
    await seedRecordWithInterval(hubId, userId, taskId, {
      mode: 'human_active',
      startedAt: new Date('2026-08-01T09:00:00Z'),
      endedAt: new Date('2026-08-01T09:30:00Z'),
    });
    await seedRecordWithInterval(hubId, userId, taskId, {
      mode: 'tool_wait',
      startedAt: new Date('2026-08-01T10:00:00Z'),
      endedAt: new Date('2026-08-01T10:15:00Z'),
    });

    const breakdown = await getTimeBreakdown(userId, { ...RANGE, groupBy: 'actor' });
    const byKey = new Map(breakdown.buckets.map((b) => [b.key, b]));
    expect(byKey.get('human')?.measures.humanEffortMs).toBe(30 * 60_000);
    expect(byKey.get('agent')?.measures.operationalWaitMs).toBe(15 * 60_000);
  });

  it('groups the same selected records by capture source', async () => {
    const { orgId, teamId, hubId, userId, statusId } = await seedTrackable('BreakdownSource');
    const taskId = await seedTask(statusId, orgId, teamId);
    await seedRecordWithInterval(hubId, userId, taskId, {
      captureSource: 'manual',
      startedAt: new Date('2026-08-01T09:00:00Z'),
      endedAt: new Date('2026-08-01T09:30:00Z'),
    });

    const breakdown = await getTimeBreakdown(userId, { ...RANGE, groupBy: 'capture_source' });

    expect(breakdown.buckets).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'manual', label: 'Manual entry' })]),
    );
  });

  it('credits only the lowest-id initiative when a project belongs to more than one', async () => {
    const { orgId, teamId, hubId, userId, humanActorId, statusId } = await seedTrackable(
      'BreakdownMultiInitiative',
    );
    const [project] = await db
      .insert(schema.project)
      .values({
        organizationId: orgId,
        name: 'Shared project',
        createdBy: humanActorId,
        status: 'planned',
        statusId: statusId('project', 'planned'),
      })
      .returning({ id: schema.project.id });
    const [initiativeA] = await db
      .insert(schema.initiative)
      .values({
        organizationId: orgId,
        name: 'Initiative A',
        createdBy: humanActorId,
        status: 'active',
        statusId: statusId('initiative', 'active'),
      })
      .returning({ id: schema.initiative.id });
    const [initiativeB] = await db
      .insert(schema.initiative)
      .values({
        organizationId: orgId,
        name: 'Initiative B',
        createdBy: humanActorId,
        status: 'active',
        statusId: statusId('initiative', 'active'),
      })
      .returning({ id: schema.initiative.id });
    const [first, second] = [assertDefined(initiativeA).id, assertDefined(initiativeB).id].sort();
    await db.insert(schema.initiativeProject).values([
      {
        initiativeId: assertDefined(first),
        projectId: assertDefined(project).id,
        organizationId: orgId,
      },
      {
        initiativeId: assertDefined(second),
        projectId: assertDefined(project).id,
        organizationId: orgId,
      },
    ]);
    const taskId = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Project task',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          projectId: assertDefined(project).id,
        })
        .returning({ id: schema.task.id }),
    ).id;
    await seedRecordWithInterval(hubId, userId, taskId, {
      startedAt: new Date('2026-08-01T09:00:00Z'),
      endedAt: new Date('2026-08-01T09:30:00Z'),
    });

    const breakdown = await getTimeBreakdown(userId, { ...RANGE, groupBy: 'initiative' });
    expect(breakdown.buckets).toHaveLength(1);
    expect(breakdown.buckets[0]?.key).toBe(first);
  });

  it('rolls an unlinked task up to the "No project/program/initiative" buckets', async () => {
    const { orgId, teamId, hubId, userId, statusId } = await seedTrackable('BreakdownUnassigned');
    const taskId = await seedTask(statusId, orgId, teamId, 'Unlinked task');
    await seedRecordWithInterval(hubId, userId, taskId, {
      startedAt: new Date('2026-08-01T09:00:00Z'),
      endedAt: new Date('2026-08-01T09:30:00Z'),
    });
    const breakdown = await getTimeBreakdown(userId, { ...RANGE, groupBy: 'project' });
    expect(breakdown.buckets).toMatchObject([{ key: 'unassigned:project', label: 'No project' }]);
  });
});
