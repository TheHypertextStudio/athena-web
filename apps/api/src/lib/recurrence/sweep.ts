/**
 * `@docket/api` — rolling recurrence materialization and missed-occurrence sweep.
 *
 * @remarks
 * The sweep is deterministic and idempotent. It expands immutable trigger revisions inside their
 * effective date segments, respects one-off exceptions, materializes the planning horizon, and
 * applies explicit missed-work policy to expected dates that have passed.
 */
import {
  processOccurrence,
  recurrenceException,
  recurrenceSeries,
  recurrenceSeriesRevision,
  recurrenceSeriesWeekday,
  type Database,
} from '@docket/db';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { addCalendarDays, compareCalendarDates } from '@docket/planning/calendar-date';
import {
  expandCalendarSchedule,
  materializationWindow,
  type RecurrenceDateExceptions,
} from './expand';
import { materializeOccurrence } from './materialize';
import { triggerFromStorage, utcCalendarDate } from './series';

/** Counts from one series rolling-window pass. */
export interface RecurrenceSeriesSweepResult {
  /** Series inspected. */
  readonly seriesId: string;
  /** New concrete occurrences materialized. */
  readonly materialized: number;
  /** Past expected dates marked skipped. */
  readonly skipped: number;
  /** Past expected dates left for explicit resolution. */
  readonly needsResolution: number;
  /** Past expected dates materialized as carried overdue work. */
  readonly carried: number;
}

/** Aggregate scheduled sweep outcome. */
export interface RecurrenceSweepResult {
  /** Active series successfully inspected. */
  readonly seriesSwept: number;
  /** New occurrences materialized across series. */
  readonly materialized: number;
  /** Missed dates automatically skipped. */
  readonly skipped: number;
  /** Missed dates requiring a person's decision. */
  readonly needsResolution: number;
  /** Missed dates carried into ordinary overdue work. */
  readonly carried: number;
  /** Per-series failures isolated from the rest of the sweep. */
  readonly failedSeriesIds: string[];
}

/** Select the later of two civil dates. */
function later(left: string, right: string): string {
  return compareCalendarDates(left, right) >= 0 ? left : right;
}

/** Select the earlier of two civil dates. */
function earlier(left: string, right: string): string {
  return compareCalendarDates(left, right) <= 0 ? left : right;
}

/** Convert persisted exception rows to the pure expansion engine's input. */
function expansionExceptions(
  rows: readonly (typeof recurrenceException.$inferSelect)[],
): RecurrenceDateExceptions {
  return {
    exclude: rows.filter((row) => row.kind === 'exclude').map((row) => row.scheduledFor),
    include: rows.filter((row) => row.kind === 'include').map((row) => row.scheduledFor),
    reschedule: rows.flatMap((row) =>
      row.kind === 'reschedule' && row.replacementDate
        ? [{ from: row.scheduledFor, to: row.replacementDate }]
        : [],
    ),
  };
}

/** Whether a durable occurrence blocks another revision from recreating the same expected date. */
function blocksReplacement(status: typeof processOccurrence.$inferSelect.status): boolean {
  return status !== 'superseded';
}

/** Apply one missed occurrence policy without duplicating prior durable decisions. */
async function applyMissedDate(
  database: Database,
  input: {
    readonly organizationId: string;
    readonly seriesId: string;
    readonly seriesRevisionId: string;
    readonly processRevisionId: string;
    readonly scheduledFor: string;
    readonly missedPolicy: 'skip' | 'carry' | 'resolve';
    readonly actorId?: string | undefined;
    readonly existingByDate: Map<string, (typeof processOccurrence.$inferSelect)[]>;
    readonly now: Date;
  },
): Promise<'none' | 'skip' | 'carry' | 'resolve'> {
  const existing = input.existingByDate.get(input.scheduledFor) ?? [];
  if (existing.some((row) => blocksReplacement(row.status))) return 'none';
  if (input.missedPolicy === 'carry') {
    await materializeOccurrence(database, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      seriesId: input.seriesId,
      seriesRevisionId: input.seriesRevisionId,
      scheduledFor: input.scheduledFor,
    });
    input.existingByDate.set(input.scheduledFor, [
      ...existing,
      {
        id: '',
        organizationId: input.organizationId,
        createdBy: input.actorId ?? null,
        createdAt: input.now,
        updatedAt: input.now,
        archivedAt: null,
        seriesId: input.seriesId,
        seriesRevisionId: input.seriesRevisionId,
        scheduledFor: input.scheduledFor,
        originalScheduledFor: null,
        status: 'materialized',
        externalOccurrenceKey: null,
        resolvedAt: null,
      },
    ]);
    return 'carry';
  }
  const status = input.missedPolicy === 'skip' ? 'skipped' : 'needs_resolution';
  const rows = await database
    .insert(processOccurrence)
    .values({
      organizationId: input.organizationId,
      seriesId: input.seriesId,
      seriesRevisionId: input.seriesRevisionId,
      scheduledFor: input.scheduledFor,
      status,
      resolvedAt: status === 'skipped' ? input.now : undefined,
      createdBy: input.actorId,
    })
    .onConflictDoNothing()
    .returning();
  const row = rows[0];
  if (!row) return 'none';
  input.existingByDate.set(input.scheduledFor, [...existing, row]);
  return input.missedPolicy;
}

/** One series' trigger revisions, with the rows each revision's expansion reads. */
interface SeriesTimeline {
  readonly revisions: readonly (typeof recurrenceSeriesRevision.$inferSelect)[];
  readonly weekdaysByRevision: ReadonlyMap<string, number[]>;
  readonly exceptionsByRevision: ReadonlyMap<string, (typeof recurrenceException.$inferSelect)[]>;
  /** Occurrences that already exist, keyed by date; written to as this sweep creates more. */
  readonly existingByDate: Map<string, (typeof processOccurrence.$inferSelect)[]>;
}

/**
 * Read one series' trigger revisions and everything their expansion has to account for.
 *
 * @param database - Docket database handle.
 * @param organizationId - The workspace that owns the series.
 * @param seriesId - The series being swept.
 * @returns The revisions in effect order, with their weekdays, exceptions, and occurrences.
 */
async function loadSeriesTimeline(
  database: Database,
  organizationId: string,
  seriesId: string,
): Promise<SeriesTimeline> {
  const revisions = await database
    .select()
    .from(recurrenceSeriesRevision)
    .where(eq(recurrenceSeriesRevision.seriesId, seriesId))
    .orderBy(asc(recurrenceSeriesRevision.effectiveFrom), asc(recurrenceSeriesRevision.number));
  const revisionIds = revisions.map((revision) => revision.id);
  const [weekdays, exceptionRows, occurrenceRows] = await Promise.all([
    revisionIds.length === 0
      ? []
      : database
          .select()
          .from(recurrenceSeriesWeekday)
          .where(inArray(recurrenceSeriesWeekday.seriesRevisionId, revisionIds)),
    revisionIds.length === 0
      ? []
      : database
          .select()
          .from(recurrenceException)
          .where(inArray(recurrenceException.seriesRevisionId, revisionIds)),
    database
      .select()
      .from(processOccurrence)
      .where(
        and(
          eq(processOccurrence.organizationId, organizationId),
          eq(processOccurrence.seriesId, seriesId),
        ),
      ),
  ]);

  const weekdaysByRevision = new Map<string, number[]>();
  for (const value of weekdays) {
    const current = weekdaysByRevision.get(value.seriesRevisionId) ?? [];
    current.push(value.weekday);
    weekdaysByRevision.set(value.seriesRevisionId, current);
  }
  const exceptionsByRevision = new Map<string, (typeof recurrenceException.$inferSelect)[]>();
  for (const value of exceptionRows) {
    const current = exceptionsByRevision.get(value.seriesRevisionId) ?? [];
    current.push(value);
    exceptionsByRevision.set(value.seriesRevisionId, current);
  }
  const existingByDate = new Map<string, (typeof processOccurrence.$inferSelect)[]>();
  for (const occurrence of occurrenceRows) {
    const current = existingByDate.get(occurrence.scheduledFor) ?? [];
    current.push(occurrence);
    existingByDate.set(occurrence.scheduledFor, current);
  }
  return { revisions, weekdaysByRevision, exceptionsByRevision, existingByDate };
}

/** The stretch of calendar one trigger revision governs. */
interface RevisionSegment {
  readonly start: string;
  /** The last date this revision governs, or `null` when it is the latest one. */
  readonly end: string | null;
  readonly exceptions: ReturnType<typeof expansionExceptions>;
}

/** One revision's share of a sweep. */
interface SweepPass {
  readonly database: Database;
  readonly input: {
    readonly organizationId: string;
    readonly seriesId: string;
    readonly actorId?: string | undefined;
    readonly asOf: string;
  };
  readonly now: Date;
  readonly timeline: SeriesTimeline;
  readonly revision: typeof recurrenceSeriesRevision.$inferSelect;
  readonly trigger: Extract<ReturnType<typeof triggerFromStorage>, { kind: 'calendar' }>;
  readonly segment: RevisionSegment;
}

/** Running counts across one series' revisions. */
interface SweepTally {
  materialized: number;
  skipped: number;
  needsResolution: number;
  carried: number;
}

/**
 * Apply the series' missed-occurrence policy to every date it should already have produced.
 *
 * @param pass - The revision being swept.
 * @param tally - The running counts, updated in place.
 */
async function resolveMissedDates(pass: SweepPass, tally: SweepTally): Promise<void> {
  const { segment, input, revision, trigger } = pass;
  const yesterday = addCalendarDays(input.asOf, -1);
  const missedThrough = segment.end ? earlier(yesterday, segment.end) : yesterday;
  if (compareCalendarDates(segment.start, missedThrough) > 0) return;

  const missedDates = expandCalendarSchedule(trigger.schedule, {
    from: segment.start,
    through: missedThrough,
    exceptions: segment.exceptions,
  }).filter((date) => compareCalendarDates(date, missedThrough) <= 0);
  for (const scheduledFor of missedDates) {
    const outcome = await applyMissedDate(pass.database, {
      organizationId: input.organizationId,
      seriesId: input.seriesId,
      seriesRevisionId: revision.id,
      processRevisionId: revision.processRevisionId,
      scheduledFor,
      missedPolicy: trigger.missedPolicy,
      actorId: input.actorId,
      existingByDate: pass.timeline.existingByDate,
      now: pass.now,
    });
    if (outcome === 'skip') tally.skipped += 1;
    if (outcome === 'resolve') tally.needsResolution += 1;
    if (outcome === 'carry') tally.carried += 1;
  }
}

/**
 * Materialize the dates ahead of the sweep that the policy window asks for.
 *
 * @remarks
 * A date whose occurrence is still `expected` is materialized in place; one already resolved some
 * other way is left alone, so re-running a sweep neither duplicates work nor undoes a decision.
 *
 * @param pass - The revision being swept.
 * @param tally - The running counts, updated in place.
 */
async function materializeUpcomingDates(pass: SweepPass, tally: SweepTally): Promise<void> {
  const { segment, input, revision, trigger } = pass;
  const futureFrom = later(input.asOf, segment.start);
  const policyWindow = materializationWindow(input.asOf, trigger.materialization);
  const nominalThrough = later(policyWindow.through, futureFrom);
  const futureThrough = segment.end ? earlier(nominalThrough, segment.end) : nominalThrough;
  if (compareCalendarDates(futureFrom, futureThrough) > 0) return;

  const upcomingDates = expandCalendarSchedule(trigger.schedule, {
    from: futureFrom,
    through: futureThrough,
    minimumOccurrences: trigger.materialization.minimumOccurrences,
    exceptions: segment.exceptions,
  }).filter((date) => segment.end === null || compareCalendarDates(date, segment.end) <= 0);

  for (const scheduledFor of upcomingDates) {
    const existing = pass.timeline.existingByDate.get(scheduledFor) ?? [];
    const sameRevision = existing.find((row) => row.seriesRevisionId === revision.id);
    if (
      sameRevision?.status !== 'expected' &&
      existing.some((row) => blocksReplacement(row.status))
    )
      continue;
    await materializeOccurrence(pass.database, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      seriesId: input.seriesId,
      seriesRevisionId: revision.id,
      scheduledFor,
    });
    tally.materialized += 1;
    if (sameRevision?.status === 'expected') continue;
    pass.timeline.existingByDate.set(scheduledFor, [
      ...existing,
      {
        id: '',
        organizationId: input.organizationId,
        createdBy: input.actorId ?? null,
        createdAt: pass.now,
        updatedAt: pass.now,
        archivedAt: null,
        seriesId: input.seriesId,
        seriesRevisionId: revision.id,
        scheduledFor,
        originalScheduledFor: null,
        status: 'materialized',
        externalOccurrenceKey: null,
        resolvedAt: null,
      },
    ]);
  }
}

/**
 * Materialize and reconcile one active series around `asOf`.
 *
 * @param database - Docket database handle.
 * @param input - Workspace, series, actor attribution, and civil sweep date.
 * @returns Work and missed-policy counts for this series.
 */
export async function materializeRecurrenceSeriesWindow(
  database: Database,
  input: {
    readonly organizationId: string;
    readonly seriesId: string;
    readonly actorId?: string | undefined;
    readonly asOf: string;
    readonly now?: Date | undefined;
  },
): Promise<RecurrenceSeriesSweepResult> {
  const now = input.now ?? new Date();
  const empty: RecurrenceSeriesSweepResult = {
    seriesId: input.seriesId,
    materialized: 0,
    skipped: 0,
    needsResolution: 0,
    carried: 0,
  };
  const seriesRows = await database
    .select()
    .from(recurrenceSeries)
    .where(
      and(
        eq(recurrenceSeries.id, input.seriesId),
        eq(recurrenceSeries.organizationId, input.organizationId),
        eq(recurrenceSeries.status, 'active'),
      ),
    )
    .limit(1);
  if (!seriesRows[0]) return empty;

  const timeline = await loadSeriesTimeline(database, input.organizationId, input.seriesId);
  const tally = { materialized: 0, skipped: 0, needsResolution: 0, carried: 0 };
  for (const [index, revision] of timeline.revisions.entries()) {
    const trigger = triggerFromStorage(
      revision,
      timeline.weekdaysByRevision.get(revision.id) ?? [],
    );
    if (trigger.kind !== 'calendar') continue;
    const nextRevision = timeline.revisions[index + 1];
    const segment = {
      start: later(revision.effectiveFrom, trigger.schedule.startDate),
      end: nextRevision ? addCalendarDays(nextRevision.effectiveFrom, -1) : null,
      exceptions: expansionExceptions(timeline.exceptionsByRevision.get(revision.id) ?? []),
    };
    const pass = { database, input, now, timeline, revision, trigger, segment };
    await resolveMissedDates(pass, tally);
    await materializeUpcomingDates(pass, tally);
  }
  return { seriesId: input.seriesId, ...tally };
}

/** Sweep every active recurrence series, isolating one series failure from the rest. */
export async function sweepRecurrenceMaterialization(
  database: Database,
  now = new Date(),
): Promise<RecurrenceSweepResult> {
  const asOf = utcCalendarDate(now);
  const series = await database
    .select({ id: recurrenceSeries.id, organizationId: recurrenceSeries.organizationId })
    .from(recurrenceSeries)
    .where(eq(recurrenceSeries.status, 'active'));
  let seriesSwept = 0;
  let materialized = 0;
  let skipped = 0;
  let needsResolution = 0;
  let carried = 0;
  const failedSeriesIds: string[] = [];
  for (const value of series) {
    try {
      const result = await materializeRecurrenceSeriesWindow(database, {
        organizationId: value.organizationId,
        seriesId: value.id,
        asOf,
        now,
      });
      seriesSwept += 1;
      materialized += result.materialized;
      skipped += result.skipped;
      needsResolution += result.needsResolution;
      carried += result.carried;
    } catch {
      failedSeriesIds.push(value.id);
    }
  }
  return { seriesSwept, materialized, skipped, needsResolution, carried, failedSeriesIds };
}
