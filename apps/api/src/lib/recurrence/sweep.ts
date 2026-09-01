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
  if (!seriesRows[0]) {
    return {
      seriesId: input.seriesId,
      materialized: 0,
      skipped: 0,
      needsResolution: 0,
      carried: 0,
    };
  }
  const revisions = await database
    .select()
    .from(recurrenceSeriesRevision)
    .where(eq(recurrenceSeriesRevision.seriesId, input.seriesId))
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
          eq(processOccurrence.organizationId, input.organizationId),
          eq(processOccurrence.seriesId, input.seriesId),
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

  let materialized = 0;
  let skipped = 0;
  let needsResolution = 0;
  let carried = 0;
  const yesterday = addCalendarDays(input.asOf, -1);
  for (const [index, revision] of revisions.entries()) {
    const trigger = triggerFromStorage(revision, weekdaysByRevision.get(revision.id) ?? []);
    if (trigger.kind !== 'calendar') continue;
    const nextRevision = revisions[index + 1];
    const segmentStart = later(revision.effectiveFrom, trigger.schedule.startDate);
    const segmentEnd = nextRevision ? addCalendarDays(nextRevision.effectiveFrom, -1) : null;
    const exceptions = expansionExceptions(exceptionsByRevision.get(revision.id) ?? []);

    const missedThrough = segmentEnd ? earlier(yesterday, segmentEnd) : yesterday;
    if (compareCalendarDates(segmentStart, missedThrough) <= 0) {
      const missedDates = expandCalendarSchedule(trigger.schedule, {
        from: segmentStart,
        through: missedThrough,
        exceptions,
      }).filter((date) => compareCalendarDates(date, missedThrough) <= 0);
      for (const scheduledFor of missedDates) {
        const outcome = await applyMissedDate(database, {
          organizationId: input.organizationId,
          seriesId: input.seriesId,
          seriesRevisionId: revision.id,
          processRevisionId: revision.processRevisionId,
          scheduledFor,
          missedPolicy: trigger.missedPolicy,
          actorId: input.actorId,
          existingByDate,
          now,
        });
        if (outcome === 'skip') skipped += 1;
        if (outcome === 'resolve') needsResolution += 1;
        if (outcome === 'carry') carried += 1;
      }
    }

    const futureFrom = later(input.asOf, segmentStart);
    const policyWindow = materializationWindow(input.asOf, trigger.materialization);
    const nominalThrough = later(policyWindow.through, futureFrom);
    const futureThrough = segmentEnd ? earlier(nominalThrough, segmentEnd) : nominalThrough;
    if (compareCalendarDates(futureFrom, futureThrough) > 0) continue;
    const upcomingDates = expandCalendarSchedule(trigger.schedule, {
      from: futureFrom,
      through: futureThrough,
      minimumOccurrences: trigger.materialization.minimumOccurrences,
      exceptions,
    }).filter((date) => segmentEnd === null || compareCalendarDates(date, segmentEnd) <= 0);
    for (const scheduledFor of upcomingDates) {
      const existing = existingByDate.get(scheduledFor) ?? [];
      const sameRevision = existing.find((row) => row.seriesRevisionId === revision.id);
      if (sameRevision?.status === 'expected') {
        await materializeOccurrence(database, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          seriesId: input.seriesId,
          seriesRevisionId: revision.id,
          scheduledFor,
        });
        materialized += 1;
        continue;
      }
      if (existing.some((row) => blocksReplacement(row.status))) continue;
      await materializeOccurrence(database, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        seriesId: input.seriesId,
        seriesRevisionId: revision.id,
        scheduledFor,
      });
      existingByDate.set(scheduledFor, [
        ...existing,
        {
          id: '',
          organizationId: input.organizationId,
          createdBy: input.actorId ?? null,
          createdAt: now,
          updatedAt: now,
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
      materialized += 1;
    }
  }
  return { seriesId: input.seriesId, materialized, skipped, needsResolution, carried };
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
