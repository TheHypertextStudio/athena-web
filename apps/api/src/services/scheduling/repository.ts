/**
 * `@docket/api` — the scheduling service's only I/O.
 *
 * @remarks
 * Everything else in `services/scheduling/` is pure. This module is the seam where the pure
 * planner meets real rows: it reads a person's preferences, the week they already have booked,
 * and what the Time Ledger measured; and it writes the generated week back as ordinary calendar
 * items so the blocks appear on the same calendar as everything else rather than in a parallel
 * universe of "planner blocks".
 *
 * Two invariants are enforced here rather than in the planner, because they are about
 * persistence rather than placement:
 *
 * 1. **The scheduler only ever deletes its own work.** A regeneration removes rows with
 *    `origin = 'scheduler'` for the week being replanned and nothing else, so a block a person
 *    dragged onto the calendar survives every future run.
 * 2. **Every generated row is attributable.** `origin`, `workShape` and `scheduleRunId` are set
 *    on insert, which is what makes "was this week actually generated, or hand-placed?" a query
 *    rather than a guess.
 */
import type { Database } from '@docket/db';
import {
  calendarItem,
  calendarItemRelation,
  calendarItemTaskLink,
  calendarLayer,
  dayCheckIn,
  dayDirective,
  dayReview,
  hub,
  organization,
  scheduleRun,
  schedulingPreference,
  timeInterval,
  timeRecord,
} from '@docket/db';
import type {
  AvailabilityWindow,
  SchedulingCommitment,
  SchedulingPreferencesUpdate,
  WorkShape,
} from '@docket/types';
import { WORK_SHAPES, workShapeProfile } from '@docket/types';
import { and, eq, gte, inArray, isNotNull, lt, lte, sql } from 'drizzle-orm';

import type { BusyItem } from './availability';
import { defaultAvailabilityWindows } from './availability';
import type { ActualsIndex } from './duration-model';
import type { PlannedBlock } from './week-planner';
import { addDays, instantAt, localDateString } from './zoned-time';

/** A Hub's resolved scheduling configuration, defaults filled in. */
export interface ResolvedSchedulingPreferences {
  readonly hubId: string;
  readonly timezone: string;
  readonly windows: readonly AvailabilityWindow[];
  readonly commitments: readonly SchedulingCommitment[];
  readonly reflectionForMeetings: boolean;
  readonly backfillShapes: readonly WorkShape[];
  readonly maxUnplannedGapMinutes: number;
  readonly minTransitGapMinutes: number;
  readonly maxTransitGapMinutes: number;
  readonly configured: boolean;
}

/** The default shapes allowed to absorb slack — the two that genuinely expand to fill time. */
const DEFAULT_BACKFILL_SHAPES: readonly WorkShape[] = [
  'deep_writing',
  'architecture_brainstorm',
  'interstitial_reading',
];

/** Docket's fallback timezone when a Hub has not set one. */
const FALLBACK_TIMEZONE = 'UTC';

/** Narrow an arbitrary stored string to a known work shape. */
function asWorkShape(value: string | null): WorkShape | null {
  if (value === null) return null;
  return (WORK_SHAPES as readonly string[]).includes(value) ? (value as WorkShape) : null;
}

/**
 * Read a Hub's scheduling configuration, substituting documented defaults where unset.
 *
 * @param db - The database client.
 * @param hubId - The owning Hub.
 * @returns the resolved configuration; `configured` is false until the person saves their own.
 */
export async function loadSchedulingPreferences(
  db: Database,
  hubId: string,
): Promise<ResolvedSchedulingPreferences> {
  const [row] = await db
    .select()
    .from(schedulingPreference)
    .where(eq(schedulingPreference.hubId, hubId))
    .limit(1);
  const [hubRow] = await db
    .select({ preferences: hub.preferences })
    .from(hub)
    .where(eq(hub.id, hubId))
    .limit(1);
  const hubTimezone =
    typeof (hubRow?.preferences as { timezone?: unknown } | null)?.timezone === 'string'
      ? (hubRow?.preferences as { timezone: string }).timezone
      : null;

  if (row === undefined) {
    return {
      hubId,
      timezone: hubTimezone ?? FALLBACK_TIMEZONE,
      windows: defaultAvailabilityWindows(),
      commitments: [],
      reflectionForMeetings: true,
      backfillShapes: DEFAULT_BACKFILL_SHAPES,
      maxUnplannedGapMinutes: 60,
      minTransitGapMinutes: 15,
      maxTransitGapMinutes: 120,
      configured: false,
    };
  }

  const windows: AvailabilityWindow[] = row.windows.map((w) => ({
    weekday: w.weekday,
    startMinute: w.startMinute,
    endMinute: w.endMinute,
    kind: w.kind as AvailabilityWindow['kind'],
    label: w.label,
  }));
  const commitments: SchedulingCommitment[] = row.commitments.flatMap((c) => {
    const shape = asWorkShape(c.shape);
    if (shape === null) return [];
    return [
      {
        id: c.id,
        shape,
        title: c.title,
        organizationId: c.organizationId as SchedulingCommitment['organizationId'],
        taskId: c.taskId as SchedulingCommitment['taskId'],
        sessionsPerWeek: c.sessionsPerWeek,
        minutesPerSession: c.minutesPerSession,
        location: c.location,
        attendees: c.attendees,
        active: c.active,
      },
    ];
  });

  return {
    hubId,
    timezone: row.timezone ?? hubTimezone ?? FALLBACK_TIMEZONE,
    windows: windows.length > 0 ? windows : defaultAvailabilityWindows(),
    commitments,
    reflectionForMeetings: row.reflectionForMeetings,
    backfillShapes: row.backfillShapes.flatMap((s) => {
      const shape = asWorkShape(s);
      return shape === null ? [] : [shape];
    }),
    maxUnplannedGapMinutes: row.maxUnplannedGapMinutes,
    minTransitGapMinutes: row.minTransitGapMinutes,
    maxTransitGapMinutes: row.maxTransitGapMinutes,
    configured: true,
  };
}

/**
 * Save a Hub's scheduling configuration, merging over whatever is there.
 *
 * @param db - The database client.
 * @param hubId - The owning Hub.
 * @param update - The partial update; every provided field replaces wholesale.
 * @param newIds - Ids to assign to commitments that arrive without one, in order.
 * @returns the resolved configuration after the write.
 */
export async function saveSchedulingPreferences(
  db: Database,
  hubId: string,
  update: SchedulingPreferencesUpdate,
  newIds: readonly string[],
): Promise<ResolvedSchedulingPreferences> {
  const current = await loadSchedulingPreferences(db, hubId);
  let idCursor = 0;
  const commitments =
    update.commitments === undefined
      ? current.commitments
      : update.commitments.map((c) => {
          const id = c.id ?? newIds[idCursor++] ?? `${hubId}-${String(idCursor)}`;
          return { ...c, id };
        });

  const values = {
    hubId,
    timezone: update.timezone ?? current.timezone,
    windows: (update.windows ?? current.windows).map((w) => ({
      weekday: w.weekday,
      startMinute: w.startMinute,
      endMinute: w.endMinute,
      kind: w.kind,
      label: w.label,
    })),
    commitments: commitments.map((c) => ({
      id: c.id,
      shape: c.shape,
      title: c.title,
      organizationId: c.organizationId,
      taskId: c.taskId,
      sessionsPerWeek: c.sessionsPerWeek,
      minutesPerSession: c.minutesPerSession,
      location: c.location,
      attendees: [...c.attendees],
      active: c.active,
    })),
    reflectionForMeetings: update.reflectionForMeetings ?? current.reflectionForMeetings,
    // Only backfill-eligible shapes are stored, so an ineligible choice cannot silently linger.
    backfillShapes: (update.backfillShapes ?? current.backfillShapes).filter(
      (s) => workShapeProfile(s).backfillEligible,
    ),
    maxUnplannedGapMinutes: update.maxUnplannedGapMinutes ?? current.maxUnplannedGapMinutes,
    minTransitGapMinutes: update.minTransitGapMinutes ?? current.minTransitGapMinutes,
    maxTransitGapMinutes: update.maxTransitGapMinutes ?? current.maxTransitGapMinutes,
  };

  await db
    .insert(schedulingPreference)
    .values(values)
    .onConflictDoUpdate({ target: schedulingPreference.hubId, set: values });
  return loadSchedulingPreferences(db, hubId);
}

/** The bounds of a local week as instants. */
export function weekBounds(weekStartDate: string, timezone: string): { start: Date; end: Date } {
  return {
    start: instantAt(weekStartDate, 0, timezone),
    end: instantAt(addDays(weekStartDate, 7), 0, timezone),
  };
}

/**
 * Read everything already on the calendar in a window.
 *
 * @param db - The database client.
 * @param userId - The owning user.
 * @param range - The instant range to read.
 * @returns busy items, including their location and attendees so travel and debriefs can be
 *   inferred from real commitments rather than declared by hand.
 */
export async function loadBusyItems(
  db: Database,
  userId: string,
  range: { start: Date; end: Date },
): Promise<BusyItem[]> {
  const rows = await db
    .select({
      id: calendarItem.id,
      title: calendarItem.title,
      startsAt: calendarItem.startsAt,
      endsAt: calendarItem.endsAt,
      location: calendarItem.location,
      attendees: calendarItem.attendees,
      workShape: calendarItem.workShape,
      origin: calendarItem.origin,
      status: calendarItem.status,
    })
    .from(calendarItem)
    .where(
      and(
        eq(calendarItem.userId, userId),
        isNotNull(calendarItem.startsAt),
        isNotNull(calendarItem.endsAt),
        gte(calendarItem.startsAt, range.start),
        lt(calendarItem.startsAt, range.end),
        sql`${calendarItem.archivedAt} is null`,
      ),
    );

  return rows.flatMap((r) => {
    /* v8 ignore next -- @preserve defensive: the query above filters both columns isNotNull */
    if (r.startsAt === null || r.endsAt === null) return [];
    if (r.status === 'cancelled') return [];
    return [
      {
        id: r.id,
        title: r.title,
        start: r.startsAt.getTime(),
        end: r.endsAt.getTime(),
        location: r.location,
        attendees: r.attendees.map((a) => a.email ?? a.displayName ?? '').filter((a) => a !== ''),
        workShape: r.workShape,
        schedulerOwned: r.origin === 'scheduler',
      },
    ];
  });
}

/**
 * Read what the Time Ledger measured, indexed the way the duration model wants it.
 *
 * @remarks
 * A "session" is one `time_record` — the person's own semantic unit of work — and its length is
 * the sum of its intervals. Records that are still open contribute nothing: an unfinished
 * session has no length yet, and counting one would systematically under-estimate every
 * estimate that used it.
 *
 * The by-shape index is built by joining a record's task back to any calendar block that carried
 * a work shape, which is what lets "how long does a filming session actually take" be answerable
 * even for a commitment that has never been tracked under its own task.
 *
 * @param db - The database client.
 * @param hubId - The owning Hub.
 * @param since - Only consider records that started at or after this instant.
 * @returns the measured index.
 */
export async function loadActuals(db: Database, hubId: string, since: Date): Promise<ActualsIndex> {
  const rows = await db
    .select({
      recordId: timeRecord.id,
      taskId: timeRecord.taskId,
      startedAt: timeInterval.startedAt,
      endedAt: timeInterval.endedAt,
    })
    .from(timeRecord)
    .innerJoin(timeInterval, eq(timeInterval.timeRecordId, timeRecord.id))
    .where(
      and(
        eq(timeRecord.hubId, hubId),
        inArray(timeRecord.status, ['closed', 'submitted']),
        gte(timeRecord.createdAt, since),
        isNotNull(timeInterval.endedAt),
      ),
    );

  const perRecord = new Map<string, { taskId: string; minutes: number }>();
  for (const row of rows) {
    /* v8 ignore next -- @preserve defensive: the query above filters isNotNull(timeInterval.endedAt) */
    if (row.endedAt === null) continue;
    // The query is already restricted to terminal records, and `time_record_closed_requires_anchor`
    // makes a terminal record without a task impossible. This states that invariant to the type
    // system rather than asserting past it.
    /* v8 ignore next -- @preserve defensive: a closed record always carries an anchor */
    if (row.taskId === null) continue;
    const minutes = Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 60_000);
    if (minutes <= 0) continue;
    const existing = perRecord.get(row.recordId);
    if (existing) existing.minutes += minutes;
    else perRecord.set(row.recordId, { taskId: row.taskId, minutes });
  }

  const byTaskId = new Map<string, { minutes: number[] }>();
  for (const { taskId, minutes } of perRecord.values()) {
    const bucket = byTaskId.get(taskId);
    if (bucket) bucket.minutes.push(minutes);
    else byTaskId.set(taskId, { minutes: [minutes] });
  }

  const shapeByTask = await loadShapeByTask(db, [...byTaskId.keys()]);
  const byShape = new Map<WorkShape, { minutes: number[] }>();
  for (const [taskId, samples] of byTaskId) {
    const shape = shapeByTask.get(taskId);
    if (shape === undefined) continue;
    const bucket = byShape.get(shape);
    if (bucket) bucket.minutes.push(...samples.minutes);
    else byShape.set(shape, { minutes: [...samples.minutes] });
  }

  return { byTaskId, byShape };
}

/** Map each tracked task to the work shape it has most recently been blocked as. */
async function loadShapeByTask(
  db: Database,
  taskIds: readonly string[],
): Promise<Map<string, WorkShape>> {
  const out = new Map<string, WorkShape>();
  if (taskIds.length === 0) return out;
  const rows = await db
    .select({
      taskId: calendarItemTaskLink.taskId,
      shape: calendarItem.workShape,
      createdAt: calendarItem.createdAt,
    })
    .from(calendarItemTaskLink)
    .innerJoin(calendarItem, eq(calendarItem.id, calendarItemTaskLink.calendarItemId))
    .where(
      and(isNotNull(calendarItem.workShape), inArray(calendarItemTaskLink.taskId, [...taskIds])),
    )
    .orderBy(sql`${calendarItem.createdAt} desc`);
  for (const row of rows) {
    const shape = asWorkShape(row.shape);
    if (shape === null) continue;
    if (!out.has(row.taskId)) out.set(row.taskId, shape);
  }
  return out;
}

/** Resolve (creating on first use) the user's native-blocks layer. */
async function resolveNativeLayerId(db: Database, userId: string): Promise<string> {
  const rows = await db
    .select({ id: calendarLayer.id })
    .from(calendarLayer)
    .where(and(eq(calendarLayer.userId, userId), eq(calendarLayer.sourceKind, 'native_blocks')))
    .orderBy(calendarLayer.createdAt)
    .limit(1);
  const existing = rows[0];
  if (existing) return existing.id;
  const inserted = await db
    .insert(calendarLayer)
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
    .returning({ id: calendarLayer.id });
  const row = inserted[0];
  /* v8 ignore next -- @preserve defensive: the insert always returns a row */
  if (row === undefined) throw new Error('native layer insert returned no row');
  return row.id;
}

/** A persisted generated block, joined back to its workspace name for display. */
export interface PersistedBlock extends PlannedBlock {
  readonly calendarItemId: string;
  readonly organizationName: string | null;
}

/**
 * Delete a previous run's blocks for a week — and only those.
 *
 * @param db - The database client.
 * @param userId - The owning user.
 * @param range - The week's instant bounds.
 * @returns how many rows were removed.
 */
export async function clearSchedulerBlocks(
  db: Database,
  userId: string,
  range: { start: Date; end: Date },
): Promise<number> {
  const removed = await db
    .delete(calendarItem)
    .where(
      and(
        eq(calendarItem.userId, userId),
        eq(calendarItem.origin, 'scheduler'),
        isNotNull(calendarItem.startsAt),
        gte(calendarItem.startsAt, range.start),
        lt(calendarItem.startsAt, range.end),
      ),
    )
    .returning({ id: calendarItem.id });
  return removed.length;
}

/**
 * Write a generated week to the calendar.
 *
 * @param db - The database client.
 * @param input.userId - The owning user.
 * @param input.runId - The run that produced these blocks.
 * @param input.blocks - What the planner decided.
 * @returns the persisted blocks, each carrying its new calendar-item id.
 */
export async function persistPlannedBlocks(
  db: Database,
  input: {
    readonly userId: string;
    readonly runId: string;
    readonly blocks: readonly PlannedBlock[];
  },
): Promise<PersistedBlock[]> {
  if (input.blocks.length === 0) return [];
  const layerId = await resolveNativeLayerId(db, input.userId);

  const idByKey = new Map<string, string>();
  const persisted: PersistedBlock[] = [];
  for (const block of input.blocks) {
    const inserted = await db
      .insert(calendarItem)
      .values({
        userId: input.userId,
        layerId,
        kind: 'native_block',
        provider: 'docket',
        status: 'confirmed',
        syncState: 'clean',
        connectionId: null,
        title: block.title,
        location: block.location,
        startsAt: new Date(block.start),
        endsAt: new Date(block.end),
        attendees: block.attendees.map((email) => ({
          email,
          displayName: null,
          responseStatus: 'needsAction',
          organizer: false,
          self: false,
          optional: false,
        })),
        workShape: block.shape,
        origin: 'scheduler',
        scheduleRunId: input.runId,
        organizationId: block.organizationId,
      })
      .returning({ id: calendarItem.id });
    const row = inserted[0];
    /* v8 ignore next -- @preserve defensive: the insert always returns a row */
    if (row === undefined) continue;
    idByKey.set(block.key, row.id);
    persisted.push({ ...block, calendarItemId: row.id, organizationName: null });
  }

  // Debriefs are linked to what they debrief, using the calendar's own relation primitive so the
  // link is visible to every other calendar surface rather than only to the planner.
  for (const block of input.blocks) {
    const sourceId =
      block.anchorCalendarItemId ??
      (block.anchorKey === null ? null : (idByKey.get(block.anchorKey) ?? null));
    const targetId = idByKey.get(block.key);
    if (sourceId === null || targetId === undefined) continue;
    await db
      .insert(calendarItemRelation)
      .values({
        sourceItemId: sourceId,
        targetItemId: targetId,
        role: 'follow_up',
        createdByUserId: input.userId,
      })
      .onConflictDoNothing();
  }

  return persisted;
}

/** Record one planning run's headline numbers. */
export async function recordScheduleRun(
  db: Database,
  input: {
    readonly hubId: string;
    readonly weekStartDate: string;
    readonly timezone: string;
    readonly blockCount: number;
    readonly availableMinutes: number;
    readonly scheduledMinutes: number;
    readonly protectedMinutes: number;
    readonly largestGapMinutes: number;
    readonly unplaced: readonly Record<string, unknown>[];
  },
): Promise<string> {
  const inserted = await db
    .insert(scheduleRun)
    .values({
      hubId: input.hubId,
      weekStartDate: input.weekStartDate,
      timezone: input.timezone,
      userInputCount: 1,
      blockCount: input.blockCount,
      availableMinutes: input.availableMinutes,
      scheduledMinutes: input.scheduledMinutes,
      protectedMinutes: input.protectedMinutes,
      largestGapMinutes: input.largestGapMinutes,
      unplaced: [...input.unplaced],
    })
    .returning({ id: scheduleRun.id });
  const row = inserted[0];
  /* v8 ignore next -- @preserve defensive: the insert always returns a row */
  if (row === undefined) throw new Error('schedule run insert returned no row');
  return row.id;
}

/** The most recent run covering a week, if any. */
export async function latestRunForWeek(
  db: Database,
  hubId: string,
  weekStartDate: string,
): Promise<typeof scheduleRun.$inferSelect | null> {
  const rows = await db
    .select()
    .from(scheduleRun)
    .where(and(eq(scheduleRun.hubId, hubId), eq(scheduleRun.weekStartDate, weekStartDate)))
    .orderBy(sql`${scheduleRun.generatedAt} desc`)
    .limit(1);
  return rows[0] ?? null;
}

/** Workspace names for a set of ids, for display on generated blocks. */
export async function loadOrganizationNames(
  db: Database,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(inArray(organization.id, unique));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Read one day's scheduler-visible blocks, ordered. */
export async function loadDayBlocks(
  db: Database,
  userId: string,
  date: string,
  timezone: string,
): Promise<
  {
    calendarItemId: string;
    title: string;
    shape: WorkShape | null;
    start: number;
    end: number;
    done: boolean;
    schedulerOwned: boolean;
    location: string | null;
  }[]
> {
  const start = instantAt(date, 0, timezone);
  const end = instantAt(addDays(date, 1), 0, timezone);
  const rows = await db
    .select({
      id: calendarItem.id,
      title: calendarItem.title,
      startsAt: calendarItem.startsAt,
      endsAt: calendarItem.endsAt,
      workShape: calendarItem.workShape,
      origin: calendarItem.origin,
      status: calendarItem.status,
      location: calendarItem.location,
    })
    .from(calendarItem)
    .where(
      and(
        eq(calendarItem.userId, userId),
        isNotNull(calendarItem.startsAt),
        isNotNull(calendarItem.endsAt),
        gte(calendarItem.startsAt, start),
        lt(calendarItem.startsAt, end),
        sql`${calendarItem.archivedAt} is null`,
      ),
    )
    .orderBy(calendarItem.startsAt);

  return rows.flatMap((r) => {
    /* v8 ignore next -- @preserve defensive: the query above filters both columns isNotNull */
    if (r.startsAt === null || r.endsAt === null) return [];
    if (r.status === 'cancelled') return [];
    return [
      {
        calendarItemId: r.id,
        title: r.title,
        shape: asWorkShape(r.workShape),
        start: r.startsAt.getTime(),
        end: r.endsAt.getTime(),
        // A block is "done" once it has been marked free — the calendar's own completion signal.
        done: r.status === 'free',
        schedulerOwned: r.origin === 'scheduler',
        location: r.location,
      },
    ];
  });
}

/** Read (creating on first use) the day's directive row. */
export async function ensureDayDirective(
  db: Database,
  input: {
    readonly hubId: string;
    readonly date: string;
    readonly timezone: string;
    readonly directiveId: string;
  },
): Promise<typeof dayDirective.$inferSelect> {
  const existing = await db
    .select()
    .from(dayDirective)
    .where(and(eq(dayDirective.hubId, input.hubId), eq(dayDirective.date, input.date)))
    .limit(1);
  const row = existing[0];
  if (row) return row;
  const inserted = await db
    .insert(dayDirective)
    .values({
      hubId: input.hubId,
      date: input.date,
      timezone: input.timezone,
      directiveId: input.directiveId,
    })
    .onConflictDoNothing()
    .returning();
  const created = inserted[0];
  if (created) return created;
  const retry = await db
    .select()
    .from(dayDirective)
    .where(and(eq(dayDirective.hubId, input.hubId), eq(dayDirective.date, input.date)))
    .limit(1);
  const found = retry[0];
  /* v8 ignore next -- @preserve defensive: one of the two paths always yields a row */
  if (found === undefined) throw new Error('day directive upsert returned no row');
  return found;
}

/** The day's check-ins, ordered. */
export async function loadCheckIns(
  db: Database,
  hubId: string,
  date: string,
): Promise<(typeof dayCheckIn.$inferSelect)[]> {
  return db
    .select()
    .from(dayCheckIn)
    .where(and(eq(dayCheckIn.hubId, hubId), eq(dayCheckIn.date, date)))
    .orderBy(dayCheckIn.scheduledAt);
}

/** The day's review row, if one has been started. */
export async function loadDayReview(
  db: Database,
  hubId: string,
  date: string,
): Promise<typeof dayReview.$inferSelect | null> {
  const rows = await db
    .select()
    .from(dayReview)
    .where(and(eq(dayReview.hubId, hubId), eq(dayReview.date, date)))
    .limit(1);
  return rows[0] ?? null;
}

/** Hubs whose day should be swept, cheapest possible predicate. */
export async function hubsWithSchedulingConfigured(
  db: Database,
): Promise<{ hubId: string; userId: string; timezone: string }[]> {
  const rows = await db
    .select({
      hubId: schedulingPreference.hubId,
      timezone: schedulingPreference.timezone,
      userId: hub.userId,
    })
    .from(schedulingPreference)
    .innerJoin(hub, eq(hub.id, schedulingPreference.hubId));
  return rows.map((r) => ({
    hubId: r.hubId,
    userId: r.userId,
    timezone: r.timezone ?? FALLBACK_TIMEZONE,
  }));
}

/** The local date "now" falls on for a Hub. */
export function hubToday(timezone: string, now: Date): string {
  return localDateString(now, timezone);
}

/** Move one calendar item, used by the drift reorganization. */
export async function moveCalendarItem(
  db: Database,
  input: {
    readonly calendarItemId: string;
    readonly userId: string;
    readonly start: Date;
    readonly end: Date;
  },
): Promise<void> {
  await db
    .update(calendarItem)
    .set({ startsAt: input.start, endsAt: input.end })
    .where(and(eq(calendarItem.id, input.calendarItemId), eq(calendarItem.userId, input.userId)));
}

/** Archive a block the day no longer has room for, preserving it for the evening review. */
export async function displaceCalendarItem(
  db: Database,
  input: { readonly calendarItemId: string; readonly userId: string; readonly at: Date },
): Promise<void> {
  await db
    .update(calendarItem)
    .set({ archivedAt: input.at })
    .where(
      and(
        eq(calendarItem.id, input.calendarItemId),
        eq(calendarItem.userId, input.userId),
        eq(calendarItem.origin, 'scheduler'),
      ),
    );
}

/** Whether a Hub's week has any generated run at all — the readiness signal's data source. */
export async function hasRunCovering(db: Database, hubId: string, date: string): Promise<boolean> {
  const rows = await db
    .select({ id: scheduleRun.id })
    .from(scheduleRun)
    .where(
      and(
        eq(scheduleRun.hubId, hubId),
        lte(scheduleRun.weekStartDate, date),
        sql`${scheduleRun.weekStartDate} >= ${addDays(date, -6)}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** One block on the wire, read straight off the calendar rather than from a cached plan. */
export interface CalendarWeekBlock {
  readonly calendarItemId: string;
  readonly shape: WorkShape;
  readonly title: string;
  readonly start: number;
  readonly end: number;
  readonly date: string;
  readonly organizationId: string | null;
  readonly location: string | null;
  readonly attendees: readonly string[];
  readonly origin: string;
  readonly anchorCalendarItemId: string | null;
}

/**
 * Read a week's shaped blocks off the calendar, with their debrief links resolved.
 *
 * @remarks
 * Only rows carrying a `work_shape` come back: an ordinary meeting synced from a provider is
 * part of the week's *busy* time (and shows on the calendar), but it is not a block the planner
 * shaped, and reporting it as one would make the coverage figure meaningless.
 *
 * @param db - The database client.
 * @param userId - The owning user.
 * @param bounds - The week's instant bounds.
 * @param timezone - IANA timezone, so each block reports the local date it falls on.
 * @returns the week's shaped blocks, ordered by start.
 */
export async function loadWeekBlocks(
  db: Database,
  userId: string,
  bounds: { start: Date; end: Date },
  timezone: string,
): Promise<CalendarWeekBlock[]> {
  const rows = await db
    .select()
    .from(calendarItem)
    .where(
      and(
        eq(calendarItem.userId, userId),
        isNotNull(calendarItem.startsAt),
        isNotNull(calendarItem.endsAt),
        isNotNull(calendarItem.workShape),
        gte(calendarItem.startsAt, bounds.start),
        lt(calendarItem.startsAt, bounds.end),
        sql`${calendarItem.archivedAt} is null`,
      ),
    )
    .orderBy(calendarItem.startsAt);

  const ids = rows.map((r) => r.id);
  const anchorByTarget = new Map<string, string>();
  if (ids.length > 0) {
    const relations = await db
      .select()
      .from(calendarItemRelation)
      .where(
        and(
          inArray(calendarItemRelation.targetItemId, ids),
          eq(calendarItemRelation.role, 'follow_up'),
        ),
      );
    for (const relation of relations) {
      anchorByTarget.set(relation.targetItemId, relation.sourceItemId);
    }
  }

  return rows.flatMap((row) => {
    const shape = asWorkShape(row.workShape);
    if (shape === null || row.startsAt === null || row.endsAt === null) return [];
    return [
      {
        calendarItemId: row.id,
        shape,
        title: row.title,
        start: row.startsAt.getTime(),
        end: row.endsAt.getTime(),
        date: localDateString(row.startsAt, timezone),
        organizationId: row.organizationId,
        location: row.location,
        attendees: row.attendees.map((a) => a.email ?? a.displayName ?? '').filter((a) => a !== ''),
        origin: row.origin,
        anchorCalendarItemId: anchorByTarget.get(row.id) ?? null,
      },
    ];
  });
}
