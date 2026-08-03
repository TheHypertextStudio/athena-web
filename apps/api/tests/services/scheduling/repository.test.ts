/**
 * `@docket/api` — direct unit coverage for `services/scheduling/repository.ts`.
 *
 * @remarks
 * The route-level scheduling tests (`schedule-week-routes.test.ts`, `directive-routes.test.ts`)
 * exercise this module's happy paths end to end. This file drives the repository functions
 * directly so the fallback/edge branches that a normal planning run never hits — a legacy row
 * with a null timezone, an invalid persisted work shape, a cancelled busy item, the Time Ledger
 * join actually returning rows — are each covered by a real, targeted fixture.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type { PlannedBlock } from '../../../src/services/scheduling/week-planner';
import { getDb, one, seedBaseOrg, seedUserWithHub } from '../../support/routes-harness';
import {
  clearSchedulerBlocks,
  displaceCalendarItem,
  ensureDayDirective,
  hasRunCovering,
  hubsWithSchedulingConfigured,
  hubToday,
  latestRunForWeek,
  loadActuals,
  loadBusyItems,
  loadDayBlocks,
  loadOrganizationNames,
  loadSchedulingPreferences,
  loadWeekBlocks,
  moveCalendarItem,
  persistPlannedBlocks,
  recordScheduleRun,
  saveSchedulingPreferences,
  weekBounds,
} from '../../../src/services/scheduling/repository';

/** A minimal, otherwise-valid `PlannedBlock`, with every field overridable. */
function plannedBlock(over: Partial<PlannedBlock> & { key: string }): PlannedBlock {
  return {
    shape: 'deep_writing',
    title: 'Block',
    date: '2026-11-20',
    start: Date.parse('2026-11-20T16:00:00Z'),
    end: Date.parse('2026-11-20T17:00:00Z'),
    organizationId: null,
    location: null,
    attendees: [],
    commitmentId: null,
    anchorKey: null,
    anchorCalendarItemId: null,
    durationSource: 'shape_default',
    ...over,
  };
}

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

const TZ = 'America/Los_Angeles';

/** Seed a user + hub, returning both ids. */
async function seedHub(label: string): Promise<{ userId: string; hubId: string }> {
  const userId = await seedUserWithHub(db, schema, label);
  const [hubRow] = await db
    .select({ id: schema.hub.id })
    .from(schema.hub)
    .where(eq(schema.hub.userId, userId))
    .limit(1);
  if (!hubRow) throw new Error('seeded user has no hub');
  return { userId, hubId: hubRow.id };
}

/** Insert (and return the id of) the user's native-blocks calendar layer. */
async function seedLayer(userId: string): Promise<string> {
  const [layer] = await db
    .insert(schema.calendarLayer)
    .values({
      userId,
      connectionId: null,
      provider: 'docket',
      sourceKind: 'native_blocks',
      title: 'Docket blocks',
      selected: true,
      visibleByDefault: true,
      editableCore: true,
      primary: false,
    })
    .returning({ id: schema.calendarLayer.id });
  if (!layer) throw new Error('layer seed failed');
  return layer.id;
}

describe('loadSchedulingPreferences', () => {
  it('falls back to the Hub-level timezone when no preferences row exists', async () => {
    const { hubId } = await seedHub('PrefsHubTz');
    await db
      .update(schema.hub)
      .set({ preferences: { timezone: 'Europe/Paris' } })
      .where(eq(schema.hub.id, hubId));
    const resolved = await loadSchedulingPreferences(db, hubId);
    expect(resolved.configured).toBe(false);
    expect(resolved.timezone).toBe('Europe/Paris');
  });

  it('falls back through a null saved timezone to the Hub timezone, then to UTC', async () => {
    const withHubTz = await seedHub('PrefsRowNullTzWithHub');
    await db
      .update(schema.hub)
      .set({ preferences: { timezone: 'Asia/Tokyo' } })
      .where(eq(schema.hub.id, withHubTz.hubId));
    await db.insert(schema.schedulingPreference).values({ hubId: withHubTz.hubId, timezone: null });
    expect((await loadSchedulingPreferences(db, withHubTz.hubId)).timezone).toBe('Asia/Tokyo');

    const bare = await seedHub('PrefsRowNullTzNoHub');
    await db.insert(schema.schedulingPreference).values({ hubId: bare.hubId, timezone: null });
    expect((await loadSchedulingPreferences(db, bare.hubId)).timezone).toBe('UTC');
  });

  it('falls back to the default windows when the saved row has none', async () => {
    const { hubId } = await seedHub('PrefsEmptyWindows');
    await db.insert(schema.schedulingPreference).values({ hubId, timezone: TZ, windows: [] });
    const resolved = await loadSchedulingPreferences(db, hubId);
    expect(resolved.windows.length).toBeGreaterThan(0);
  });

  it('drops a commitment or backfill shape that is not a recognized WorkShape', async () => {
    const { hubId } = await seedHub('PrefsInvalidShapes');
    await db.insert(schema.schedulingPreference).values({
      hubId,
      timezone: TZ,
      commitments: [
        {
          id: 'c1',
          shape: 'not_a_real_shape',
          title: 'Bogus',
          organizationId: null,
          taskId: null,
          sessionsPerWeek: 1,
          minutesPerSession: null,
          location: null,
          attendees: [],
          active: true,
        },
        {
          id: 'c2',
          shape: 'deep_writing',
          title: 'Real',
          organizationId: null,
          taskId: null,
          sessionsPerWeek: 1,
          minutesPerSession: null,
          location: null,
          attendees: [],
          active: true,
        },
      ],
      backfillShapes: ['not_a_real_shape', 'architecture_brainstorm'],
    });
    const resolved = await loadSchedulingPreferences(db, hubId);
    expect(resolved.commitments.map((c) => c.id)).toEqual(['c2']);
    expect(resolved.backfillShapes).toEqual(['architecture_brainstorm']);
  });
});

describe('saveSchedulingPreferences', () => {
  it('mints a synthetic id once the supplied newIds run out', async () => {
    const { hubId } = await seedHub('PrefsIdOverflow');
    const resolved = await saveSchedulingPreferences(
      db,
      hubId,
      {
        commitments: [
          {
            shape: 'deep_writing',
            title: 'First',
            organizationId: null,
            taskId: null,
            sessionsPerWeek: 1,
            minutesPerSession: null,
            location: null,
            attendees: [],
            active: true,
          },
          {
            shape: 'interstitial_reading',
            title: 'Second',
            organizationId: null,
            taskId: null,
            sessionsPerWeek: 1,
            minutesPerSession: null,
            location: null,
            attendees: [],
            active: true,
          },
        ],
      },
      ['only-one-id'],
    );
    expect(resolved.commitments.map((c) => c.id)).toEqual(['only-one-id', `${hubId}-2`]);
  });
});

describe('loadBusyItems', () => {
  it('excludes a cancelled item and resolves attendees through the email/displayName fallback', async () => {
    const { userId } = await seedHub('BusyItems');
    const layerId = await seedLayer(userId);
    const start = new Date('2026-11-02T16:00:00Z');
    const end = new Date('2026-11-02T17:00:00Z');
    await db.insert(schema.calendarItem).values([
      {
        userId,
        layerId,
        kind: 'event',
        provider: 'google',
        status: 'confirmed',
        syncState: 'clean',
        title: 'Kept meeting',
        startsAt: start,
        endsAt: end,
        origin: 'provider',
        attendees: [
          { email: 'a@example.com', displayName: 'A' },
          { email: null, displayName: 'No Email' },
          { email: null, displayName: null },
        ],
      },
      {
        userId,
        layerId,
        kind: 'event',
        provider: 'google',
        status: 'cancelled',
        syncState: 'clean',
        title: 'Cancelled meeting',
        startsAt: start,
        endsAt: end,
        origin: 'provider',
      },
    ]);
    const busy = await loadBusyItems(db, userId, {
      start: new Date('2026-11-02T00:00:00Z'),
      end: new Date('2026-11-03T00:00:00Z'),
    });
    expect(busy).toHaveLength(1);
    expect(busy[0]?.title).toBe('Kept meeting');
    expect(busy[0]?.attendees).toEqual(['a@example.com', 'No Email']);
  });
});

describe('loadActuals', () => {
  it('sums closed sessions per task and rolls them up by the task’s most recent work shape', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const { userId, hubId } = await seedHub('ActualsHub');
    const layerId = await seedLayer(userId);

    const mkTask = async (title: string) =>
      one(
        await db
          .insert(schema.task)
          .values({ organizationId: orgId, teamId, title, state: 'todo', createdBy: humanActorId })
          .returning({ id: schema.task.id }),
      ).id;
    const filmingTask = await mkTask('Filming task');
    const writingTaskA = await mkTask('Writing task A');
    const writingTaskB = await mkTask('Writing task B');
    const unshapedTask = await mkTask('Unshaped task');
    const invalidShapeTask = await mkTask('Invalid shape task');

    // Blocked with a real shape (most recent wins over an older, different shape).
    const shapeBlock = async (taskId: string, shape: string | null, createdAt: Date) => {
      const [item] = await db
        .insert(schema.calendarItem)
        .values({
          userId,
          layerId,
          kind: 'native_block',
          provider: 'docket',
          status: 'confirmed',
          syncState: 'clean',
          title: 'Block',
          startsAt: new Date(),
          endsAt: new Date(),
          workShape: shape,
          origin: 'scheduler',
          createdAt,
        })
        .returning({ id: schema.calendarItem.id });
      if (!item) throw new Error('block insert failed');
      await db.insert(schema.calendarItemTaskLink).values({
        calendarItemId: item.id,
        taskId,
        organizationId: orgId,
        createdBy: humanActorId,
      });
    };
    await shapeBlock(filmingTask, 'community_meeting', new Date('2026-01-01T00:00:00Z'));
    await shapeBlock(filmingTask, 'filming_session', new Date('2026-06-01T00:00:00Z')); // most recent wins
    await shapeBlock(writingTaskA, 'deep_writing', new Date('2026-06-01T00:00:00Z'));
    await shapeBlock(writingTaskB, 'deep_writing', new Date('2026-06-01T00:00:00Z'));
    // A block whose stored work_shape is not a recognized WorkShape — filtered out, not crashed.
    await shapeBlock(invalidShapeTask, 'not_a_real_shape', new Date('2026-06-01T00:00:00Z'));

    const since = new Date('2026-01-01T00:00:00Z');
    const mkRecord = async (taskId: string, status: 'closed' | 'submitted' | 'open') =>
      one(
        await db
          .insert(schema.timeRecord)
          .values({
            hubId,
            createdByUserId: userId,
            taskId,
            title: 'Session',
            status,
            startedAt: new Date('2026-07-01T09:00:00Z'),
          })
          .returning({ id: schema.timeRecord.id }),
      ).id;
    const mkInterval = async (
      recordId: string,
      taskId: string,
      startedAt: Date,
      endedAt: Date | null,
    ) =>
      db.insert(schema.timeInterval).values({
        timeRecordId: recordId,
        hubId,
        taskId,
        actorKind: 'human',
        userId,
        mode: 'human_active',
        source: 'user_timer',
        startedAt,
        endedAt,
      });

    // Filming: two intervals on the SAME record — minutes accumulate on one bucket entry.
    const filmingRecord = await mkRecord(filmingTask, 'closed');
    await mkInterval(
      filmingRecord,
      filmingTask,
      new Date('2026-07-01T09:00:00Z'),
      new Date('2026-07-01T09:30:00Z'),
    );
    await mkInterval(
      filmingRecord,
      filmingTask,
      new Date('2026-07-01T10:00:00Z'),
      new Date('2026-07-01T10:15:00Z'),
    );
    // ...plus a still-open interval on the same record, which must not count.
    await mkInterval(filmingRecord, filmingTask, new Date('2026-07-01T11:00:00Z'), null);
    // ...and a zero-duration interval, which must not count either.
    const zeroAt = new Date('2026-07-01T12:00:00Z');
    await mkInterval(filmingRecord, filmingTask, zeroAt, zeroAt);
    // A SECOND closed record for the same task — the byTaskId aggregation bucket already
    // exists, so this exercises the "merge into the existing bucket" branch rather than always
    // creating a fresh one.
    const filmingRecord2 = await mkRecord(filmingTask, 'closed');
    await mkInterval(
      filmingRecord2,
      filmingTask,
      new Date('2026-07-01T13:00:00Z'),
      new Date('2026-07-01T13:10:00Z'),
    );

    // Writing: two DIFFERENT records/tasks sharing the 'deep_writing' shape — bucket merges.
    const writingRecordA = await mkRecord(writingTaskA, 'submitted');
    await mkInterval(
      writingRecordA,
      writingTaskA,
      new Date('2026-07-02T09:00:00Z'),
      new Date('2026-07-02T10:00:00Z'),
    );
    const writingRecordB = await mkRecord(writingTaskB, 'closed');
    await mkInterval(
      writingRecordB,
      writingTaskB,
      new Date('2026-07-03T09:00:00Z'),
      new Date('2026-07-03T09:45:00Z'),
    );

    // Unshaped task: closed, measured, but no calendar block ever gave it a shape.
    const unshapedRecord = await mkRecord(unshapedTask, 'closed');
    await mkInterval(
      unshapedRecord,
      unshapedTask,
      new Date('2026-07-04T09:00:00Z'),
      new Date('2026-07-04T09:20:00Z'),
    );

    // An open record is excluded entirely by the query itself (status filter).
    const openRecord = await mkRecord(unshapedTask, 'open');
    await mkInterval(
      openRecord,
      unshapedTask,
      new Date('2026-07-05T09:00:00Z'),
      new Date('2026-07-05T09:20:00Z'),
    );

    // A task that WAS measured, but whose only calendar block carries an unrecognized work
    // shape — reaches `loadShapeByTask`'s query (it has a timed record) and is filtered there.
    const invalidShapeRecord = await mkRecord(invalidShapeTask, 'closed');
    await mkInterval(
      invalidShapeRecord,
      invalidShapeTask,
      new Date('2026-07-06T09:00:00Z'),
      new Date('2026-07-06T09:20:00Z'),
    );

    const actuals = await loadActuals(db, hubId, since);

    const sorted = (minutes: readonly number[] | undefined): number[] =>
      [...(minutes ?? [])].sort((a, b) => a - b);

    expect(sorted(actuals.byTaskId.get(filmingTask)?.minutes)).toEqual([10, 45]);
    expect(actuals.byTaskId.get(writingTaskA)?.minutes).toEqual([60]);
    expect(actuals.byTaskId.get(writingTaskB)?.minutes).toEqual([45]);
    expect(actuals.byTaskId.get(unshapedTask)?.minutes).toEqual([20]);
    expect(actuals.byTaskId.get(invalidShapeTask)?.minutes).toEqual([20]);

    expect(sorted(actuals.byShape.get('filming_session')?.minutes)).toEqual([10, 45]);
    expect(sorted(actuals.byShape.get('deep_writing')?.minutes)).toEqual([45, 60]);
    expect(actuals.byShape.has('community_meeting')).toBe(false); // superseded by the later block
  });

  it('returns empty indexes when nothing has been tracked', async () => {
    const { hubId } = await seedHub('ActualsEmpty');
    const actuals = await loadActuals(db, hubId, new Date('2020-01-01T00:00:00Z'));
    expect(actuals.byTaskId.size).toBe(0);
    expect(actuals.byShape.size).toBe(0);
  });
});

describe('persistPlannedBlocks', () => {
  it('is a no-op for an empty block list', async () => {
    const { userId } = await seedHub('PersistEmpty');
    const persisted = await persistPlannedBlocks(db, { userId, runId: 'run_x', blocks: [] });
    expect(persisted).toEqual([]);
  });

  it('links a debrief to an anchor from an EARLIER run via anchorCalendarItemId', async () => {
    const { userId } = await seedHub('PersistAnchorPreexisting');
    const layerId = await seedLayer(userId);
    const [existingAnchor] = await db
      .insert(schema.calendarItem)
      .values({
        userId,
        layerId,
        kind: 'native_block',
        provider: 'docket',
        status: 'confirmed',
        syncState: 'clean',
        title: 'Earlier meeting',
        startsAt: new Date('2026-11-20T15:00:00Z'),
        endsAt: new Date('2026-11-20T16:00:00Z'),
        workShape: 'community_meeting',
        origin: 'scheduler',
      })
      .returning({ id: schema.calendarItem.id });
    if (!existingAnchor) throw new Error('seed failed');

    const persisted = await persistPlannedBlocks(db, {
      userId,
      runId: 'run_anchor_preexisting',
      blocks: [
        plannedBlock({
          key: 'debrief-1',
          shape: 'reflection_debrief',
          anchorCalendarItemId: existingAnchor.id,
        }),
      ],
    });
    expect(persisted).toHaveLength(1);
    const relations = await db
      .select()
      .from(schema.calendarItemRelation)
      .where(eq(schema.calendarItemRelation.sourceItemId, existingAnchor.id));
    expect(relations).toHaveLength(1);
    expect(relations[0]?.targetItemId).toBe(persisted[0]?.calendarItemId);
  });

  it('links a debrief to an anchor from the SAME run via anchorKey, and skips a standalone block', async () => {
    const { userId } = await seedHub('PersistAnchorSameRun');
    const persisted = await persistPlannedBlocks(db, {
      userId,
      runId: 'run_anchor_same_run',
      blocks: [
        plannedBlock({ key: 'meeting-1' }), // standalone: no anchor at all
        plannedBlock({ key: 'debrief-1', shape: 'reflection_debrief', anchorKey: 'meeting-1' }),
        // A dangling anchorKey — no block in this batch carries that key — resolves through the
        // `idByKey.get(...) ?? null` fallback instead of crashing on a missing lookup.
        plannedBlock({ key: 'debrief-2', shape: 'reflection_debrief', anchorKey: 'no-such-key' }),
      ],
    });
    expect(persisted).toHaveLength(3);
    const meetingId = persisted.find((p) => p.key === 'meeting-1')?.calendarItemId;
    const debriefId = persisted.find((p) => p.key === 'debrief-1')?.calendarItemId;
    const relations = await db
      .select()
      .from(schema.calendarItemRelation)
      .where(eq(schema.calendarItemRelation.createdByUserId, userId));
    expect(relations).toEqual([
      expect.objectContaining({ sourceItemId: meetingId, targetItemId: debriefId }),
    ]);
  });
});

describe('loadWeekBlocks', () => {
  it('skips the relation lookup for an empty week and filters an invalid persisted work shape', async () => {
    const { userId } = await seedHub('WeekBlocksInvalidShape');
    const bounds = weekBounds('2026-11-02', TZ);
    // Nothing generated yet: ids.length === 0, so the follow-up relation query never runs.
    expect(await loadWeekBlocks(db, userId, bounds, TZ)).toEqual([]);

    const layerId = await seedLayer(userId);
    await db.insert(schema.calendarItem).values({
      userId,
      layerId,
      kind: 'native_block',
      provider: 'docket',
      status: 'confirmed',
      syncState: 'clean',
      title: 'Corrupt block',
      startsAt: new Date('2026-11-03T16:00:00Z'),
      endsAt: new Date('2026-11-03T17:00:00Z'),
      workShape: 'not_a_real_shape',
      origin: 'scheduler',
    });
    // A row with startsAt/endsAt present but no recognized work shape is dropped, not thrown.
    expect(await loadWeekBlocks(db, userId, bounds, TZ)).toEqual([]);
  });

  it('resolves attendees through the email/displayName fallback', async () => {
    const { userId } = await seedHub('WeekBlocksAttendees');
    const layerId = await seedLayer(userId);
    const bounds = weekBounds('2026-11-16', TZ);
    await db.insert(schema.calendarItem).values({
      userId,
      layerId,
      kind: 'native_block',
      provider: 'docket',
      status: 'confirmed',
      syncState: 'clean',
      title: 'Shaped block',
      startsAt: new Date('2026-11-17T16:00:00Z'),
      endsAt: new Date('2026-11-17T17:00:00Z'),
      workShape: 'community_meeting',
      origin: 'scheduler',
      attendees: [
        { email: 'rider@example.org', displayName: 'Rider' },
        { email: null, displayName: 'No Email' },
        { email: null, displayName: null },
      ],
    });
    const blocks = await loadWeekBlocks(db, userId, bounds, TZ);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.attendees).toEqual(['rider@example.org', 'No Email']);
  });
});

describe('clearSchedulerBlocks', () => {
  it('removes only scheduler-owned rows within the given week', async () => {
    const { userId } = await seedHub('ClearScheduler');
    const layerId = await seedLayer(userId);
    const bounds = weekBounds('2026-11-02', TZ);
    await db.insert(schema.calendarItem).values([
      {
        userId,
        layerId,
        kind: 'native_block',
        provider: 'docket',
        status: 'confirmed',
        syncState: 'clean',
        title: 'Scheduler block',
        startsAt: new Date('2026-11-03T16:00:00Z'),
        endsAt: new Date('2026-11-03T17:00:00Z'),
        origin: 'scheduler',
      },
      {
        userId,
        layerId,
        kind: 'native_block',
        provider: 'docket',
        status: 'confirmed',
        syncState: 'clean',
        title: 'Hand placed',
        startsAt: new Date('2026-11-03T18:00:00Z'),
        endsAt: new Date('2026-11-03T19:00:00Z'),
        origin: 'user',
      },
    ]);
    const removed = await clearSchedulerBlocks(db, userId, bounds);
    expect(removed).toBe(1);
    const remaining = await db
      .select({ title: schema.calendarItem.title })
      .from(schema.calendarItem)
      .where(eq(schema.calendarItem.userId, userId));
    expect(remaining.map((r) => r.title)).toEqual(['Hand placed']);
  });
});

describe('loadOrganizationNames', () => {
  it('returns an empty map for an empty id list', async () => {
    expect(await loadOrganizationNames(db, [])).toEqual(new Map());
  });
});

describe('loadDayBlocks', () => {
  it('excludes a cancelled block from the day', async () => {
    const { userId } = await seedHub('DayBlocksCancelled');
    const layerId = await seedLayer(userId);
    await db.insert(schema.calendarItem).values([
      {
        userId,
        layerId,
        kind: 'native_block',
        provider: 'docket',
        status: 'confirmed',
        syncState: 'clean',
        title: 'Kept',
        startsAt: new Date('2026-11-04T16:00:00Z'),
        endsAt: new Date('2026-11-04T17:00:00Z'),
        origin: 'scheduler',
      },
      {
        userId,
        layerId,
        kind: 'native_block',
        provider: 'docket',
        status: 'cancelled',
        syncState: 'clean',
        title: 'Cancelled',
        startsAt: new Date('2026-11-04T18:00:00Z'),
        endsAt: new Date('2026-11-04T19:00:00Z'),
        origin: 'scheduler',
      },
    ]);
    const blocks = await loadDayBlocks(db, userId, '2026-11-04', TZ);
    expect(blocks.map((b) => b.title)).toEqual(['Kept']);
  });
});

describe('ensureDayDirective', () => {
  it('returns the same row on every call, including the onConflictDoNothing race path', async () => {
    const { hubId } = await seedHub('DayDirectiveRace');
    const input = { hubId, date: '2026-11-05', timezone: TZ, directiveId: 'directive_1' };

    // Enough concurrent first-callers that at least one loses the insert race and has to fall
    // back to re-reading the row the winner just created (the `onConflictDoNothing` branch).
    const results = await Promise.all(
      Array.from({ length: 8 }, () => ensureDayDirective(db, input)),
    );
    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(1); // every caller converged on the same row

    const rows = await db
      .select()
      .from(schema.dayDirective)
      .where(and(eq(schema.dayDirective.hubId, hubId), eq(schema.dayDirective.date, input.date)));
    expect(rows).toHaveLength(1);

    // A subsequent call takes the fast "already exists" path.
    const again = await ensureDayDirective(db, input);
    expect(again.id).toBe(rows[0]?.id);
  });
});

describe('hubsWithSchedulingConfigured / hubToday', () => {
  it('lists every Hub with saved preferences, defaulting a null timezone to UTC', async () => {
    const withTz = await seedHub('SweepWithTz');
    await saveSchedulingPreferences(db, withTz.hubId, { timezone: 'America/New_York' }, []);
    const withoutTz = await seedHub('SweepWithoutTz');
    await db.insert(schema.schedulingPreference).values({ hubId: withoutTz.hubId, timezone: null });
    const unconfigured = await seedHub('SweepUnconfigured');

    const rows = await hubsWithSchedulingConfigured(db);
    const byHub = new Map(rows.map((r) => [r.hubId, r]));
    expect(byHub.get(withTz.hubId)?.timezone).toBe('America/New_York');
    expect(byHub.get(withTz.hubId)?.userId).toBe(withTz.userId);
    expect(byHub.get(withoutTz.hubId)?.timezone).toBe('UTC');
    expect(byHub.has(unconfigured.hubId)).toBe(false);
  });

  it('resolves the local date for a timezone from an instant', () => {
    // New Year's Eve evening in Los Angeles is still Dec 31 there, though already Jan 1 UTC.
    expect(hubToday('America/Los_Angeles', new Date('2027-01-01T04:00:00Z'))).toBe('2026-12-31');
  });
});

describe('moveCalendarItem / displaceCalendarItem', () => {
  it('moves an item to new times and archives a scheduler-owned item', async () => {
    const { userId } = await seedHub('MoveDisplace');
    const layerId = await seedLayer(userId);
    const [item] = await db
      .insert(schema.calendarItem)
      .values({
        userId,
        layerId,
        kind: 'native_block',
        provider: 'docket',
        status: 'confirmed',
        syncState: 'clean',
        title: 'Movable',
        startsAt: new Date('2026-11-06T16:00:00Z'),
        endsAt: new Date('2026-11-06T17:00:00Z'),
        origin: 'scheduler',
      })
      .returning({ id: schema.calendarItem.id });
    if (!item) throw new Error('seed failed');

    const newStart = new Date('2026-11-06T18:00:00Z');
    const newEnd = new Date('2026-11-06T19:00:00Z');
    await moveCalendarItem(db, { calendarItemId: item.id, userId, start: newStart, end: newEnd });
    const moved = one(
      await db.select().from(schema.calendarItem).where(eq(schema.calendarItem.id, item.id)),
    );
    expect(moved.startsAt).toEqual(newStart);
    expect(moved.endsAt).toEqual(newEnd);

    const at = new Date('2026-11-06T20:00:00Z');
    await displaceCalendarItem(db, { calendarItemId: item.id, userId, at });
    const displaced = one(
      await db.select().from(schema.calendarItem).where(eq(schema.calendarItem.id, item.id)),
    );
    expect(displaced.archivedAt).toEqual(at);
  });

  it('refuses to displace an item the scheduler does not own', async () => {
    const { userId } = await seedHub('DisplaceUserOwned');
    const layerId = await seedLayer(userId);
    const [item] = await db
      .insert(schema.calendarItem)
      .values({
        userId,
        layerId,
        kind: 'native_block',
        provider: 'docket',
        status: 'confirmed',
        syncState: 'clean',
        title: 'Hand placed',
        startsAt: new Date('2026-11-07T16:00:00Z'),
        endsAt: new Date('2026-11-07T17:00:00Z'),
        origin: 'user',
      })
      .returning({ id: schema.calendarItem.id });
    if (!item) throw new Error('seed failed');
    await displaceCalendarItem(db, { calendarItemId: item.id, userId, at: new Date() });
    const row = one(
      await db.select().from(schema.calendarItem).where(eq(schema.calendarItem.id, item.id)),
    );
    expect(row.archivedAt).toBeNull();
  });
});

describe('latestRunForWeek', () => {
  it('returns null when no run has been recorded for that week', async () => {
    const { hubId } = await seedHub('LatestRunNone');
    expect(await latestRunForWeek(db, hubId, '2026-11-09')).toBeNull();
  });
});

describe('hasRunCovering', () => {
  it('is false before any run, true once one is recorded for that week', async () => {
    const { hubId } = await seedHub('HasRunCovering');
    expect(await hasRunCovering(db, hubId, '2026-11-10')).toBe(false);
    await recordScheduleRun(db, {
      hubId,
      weekStartDate: '2026-11-09',
      timezone: TZ,
      blockCount: 0,
      availableMinutes: 0,
      scheduledMinutes: 0,
      protectedMinutes: 0,
      largestGapMinutes: 0,
      unplaced: [],
    });
    expect(await hasRunCovering(db, hubId, '2026-11-10')).toBe(true);
  });
});
