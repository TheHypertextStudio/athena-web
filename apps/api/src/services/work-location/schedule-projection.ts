/** Translation and outbox materialization for canonical work-schedule provider projections. */
import { workLocationAssertion, type Database } from '@docket/db';
import {
  addCalendarDays,
  compareCalendarDates,
  mondayWeekdayIndex,
} from '@docket/planning/calendar-date';
import type {
  WorkLocationSchedule,
  WorkScheduleOut,
  WorkSchedulePlanOut,
  WorkScheduleSegment,
} from '@docket/planning/work-location-contract';
import { expandWorkSchedulePlan } from '@docket/planning/work-schedule';
import { instantAt } from '@docket/planning/zoned-time';
import { and, eq } from 'drizzle-orm';

import {
  archiveWorkLocationAssertion,
  enqueueWorkLocationProjection,
  listWorkLocationAssertions,
} from './repository';
import { listWorkSchedule } from './schedule-repository';

/** One stable provider projection derived from a plan version. */
export interface WorkScheduleProjectionItem {
  /** Stable logical key used to reconcile rolling projection windows. */
  readonly key: string;
  /** Canonical plan version that owns this projection. */
  readonly planVersionId: string;
  /** Dated replacement that supplied the segment, when one exists. */
  readonly exceptionId: string | null;
  /** Civil occurrence date for a dated item, or null for weekly recurrence. */
  readonly occurrenceDate: string | null;
  /** Saved place projected to the provider. */
  readonly placeId: string;
  /** Provider-neutral schedule accepted by the existing adapters. */
  readonly schedule: WorkLocationSchedule;
  /** Canonical revision used to recognize stale writes. */
  readonly revision: number;
}

/** Inputs for planning a bounded provider projection window. */
export interface PlanWorkScheduleProjectionInput {
  /** Complete canonical schedule. */
  readonly schedule: WorkScheduleOut;
  /** Inclusive first civil date in the projection window. */
  readonly startDate: string;
  /** Inclusive final civil date in the projection window. */
  readonly endDate: string;
}

/** Return the later of two civil dates. */
function laterDate(left: string, right: string): string {
  return compareCalendarDates(left, right) >= 0 ? left : right;
}

/** Return the earlier of two civil dates. */
function earlierDate(left: string, right: string): string {
  return compareCalendarDates(left, right) <= 0 ? left : right;
}

/** Whether a segment maps exactly to the existing weekly provider contract. */
function supportsWeeklyProjection(segment: WorkScheduleSegment): boolean {
  return (
    segment.location.type === 'saved_place' &&
    segment.startMinute + segment.durationMinutes <= 1_440
  );
}

/** Stable signature for combining identical segments across cycle weekdays. */
function segmentSignature(segment: WorkScheduleSegment): string {
  if (segment.location.type !== 'saved_place') return '';
  return `${String(segment.startMinute)}:${String(segment.durationMinutes)}:${segment.location.placeId}`;
}

/** Build weekly provider rules when one seven-day plan has no dated changes in the window. */
function weeklyPlanProjection(
  plan: WorkSchedulePlanOut,
  startDate: string,
  endDate: string,
): WorkScheduleProjectionItem[] | null {
  if (plan.cycleDays.length !== 7) return null;
  const savedSegments = plan.cycleDays.flatMap((day) =>
    day.segments.filter((segment) => segment.location.type === 'saved_place'),
  );
  if (!savedSegments.every(supportsWeeklyProjection)) return null;
  const grouped = new Map<
    string,
    { readonly segment: WorkScheduleSegment; readonly weekdays: number[] }
  >();
  plan.cycleDays.forEach((day, dayIndex) => {
    day.segments.forEach((segment) => {
      if (segment.location.type !== 'saved_place') return;
      const signature = segmentSignature(segment);
      const existing = grouped.get(signature);
      const weekday = mondayWeekdayIndex(addCalendarDays(plan.anchorDate, dayIndex));
      if (existing) existing.weekdays.push(weekday);
      else grouped.set(signature, { segment, weekdays: [weekday] });
    });
  });
  const windowStart = laterDate(plan.effectiveFrom, startDate);
  const windowEnd = earlierDate(plan.effectiveUntil ?? endDate, endDate);
  if (compareCalendarDates(windowEnd, windowStart) < 0) return [];
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([signature, group]) => {
      const segment = group.segment;
      if (segment.location.type !== 'saved_place') {
        throw new Error('Weekly work-schedule projection lost its saved place');
      }
      const schedule: WorkLocationSchedule =
        segment.startMinute === 0 && segment.durationMinutes === 1_440
          ? {
              type: 'weekly_all_day',
              effectiveFrom: plan.effectiveFrom,
              effectiveUntil: plan.effectiveUntil,
              weekdays: group.weekdays.sort((left, right) => left - right),
              timezone: plan.timezone,
            }
          : {
              type: 'weekly_timed',
              effectiveFrom: plan.effectiveFrom,
              effectiveUntil: plan.effectiveUntil,
              weekdays: group.weekdays.sort((left, right) => left - right),
              startMinute: segment.startMinute,
              endMinute: segment.startMinute + segment.durationMinutes,
              timezone: plan.timezone,
            };
      return {
        key: `${plan.id}:weekly:${signature}`,
        planVersionId: plan.id,
        exceptionId: null,
        occurrenceDate: null,
        placeId: segment.location.placeId,
        schedule,
        revision: plan.revision,
      };
    });
}

/** Expand a plan into dated provider items within one bounded window. */
function datedPlanProjection(
  plan: WorkSchedulePlanOut,
  schedule: WorkScheduleOut,
  startDate: string,
  endDate: string,
): WorkScheduleProjectionItem[] {
  const exceptions = schedule.exceptions.filter((exception) => exception.planVersionId === plan.id);
  return expandWorkSchedulePlan({ plan, exceptions, startDate, endDate }).flatMap((day) =>
    day.segments.flatMap((segment, segmentIndex) => {
      if (segment.location.type !== 'saved_place') return [];
      const allDay =
        segment.startsAt === instantAt(day.date, 0, plan.timezone).toISOString() &&
        segment.endsAt === instantAt(addCalendarDays(day.date, 1), 0, plan.timezone).toISOString();
      const itemSchedule: WorkLocationSchedule = allDay
        ? { type: 'one_off_all_day', date: day.date, timezone: plan.timezone }
        : {
            type: 'one_off_timed',
            startsAt: segment.startsAt,
            endsAt: segment.endsAt,
            timezone: plan.timezone,
          };
      return [
        {
          key: `${plan.id}:${day.date}:${String(segmentIndex)}`,
          planVersionId: plan.id,
          exceptionId: day.exceptionId,
          occurrenceDate: day.date,
          placeId: segment.location.placeId,
          schedule: itemSchedule,
          revision: plan.revision,
        },
      ];
    }),
  );
}

/**
 * Plan the complete provider projection for an inclusive civil-date window.
 *
 * @param input - Canonical schedule and requested window.
 * @returns Stable weekly or dated location assertions. Non-place work is deliberately omitted.
 */
export function planWorkScheduleProjection(
  input: PlanWorkScheduleProjectionInput,
): WorkScheduleProjectionItem[] {
  if (compareCalendarDates(input.endDate, input.startDate) < 0) {
    throw new RangeError('Work-schedule projection cannot end before it starts');
  }
  return input.schedule.plans.flatMap((plan) => {
    const hasException = input.schedule.exceptions.some(
      (exception) => exception.planVersionId === plan.id,
    );
    const weekly = hasException ? null : weeklyPlanProjection(plan, input.startDate, input.endDate);
    return weekly ?? datedPlanProjection(plan, input.schedule, input.startDate, input.endDate);
  });
}

/** Explicit or derived civil-date window for one outbox refresh. */
export interface WorkScheduleProjectionWindow {
  /** Inclusive first civil date. */
  readonly startDate: string;
  /** Inclusive final civil date. */
  readonly endDate: string;
}

/** Whether one generated assertion still represents the desired projection. */
function projectionMatches(
  existing: typeof workLocationAssertion.$inferSelect,
  desired: WorkScheduleProjectionItem,
): boolean {
  return (
    existing.archivedAt === null &&
    existing.placeId === desired.placeId &&
    JSON.stringify(existing.schedule) === JSON.stringify(desired.schedule) &&
    existing.sourcePlanVersionId === desired.planVersionId
  );
}

/** Whether a stale generated assertion belongs to the bounded window that may be replaced. */
function staleProjectionIsMutable(
  row: typeof workLocationAssertion.$inferSelect,
  window: WorkScheduleProjectionWindow,
): boolean {
  if (!row.sourcePlanKey) return false;
  if (row.sourcePlanKey.includes(':weekly:')) return true;
  const date = /:(\d{4}-\d{2}-\d{2}):/.exec(row.sourcePlanKey)?.[1];
  return date ? compareCalendarDates(date, window.startDate) >= 0 : false;
}

type ProjectionChange = readonly [string, 'create' | 'update'];

/** Create or update one desired compatibility assertion. */
async function materializeProjection(
  database: Database,
  hubId: string,
  item: WorkScheduleProjectionItem,
  existingByKey: ReadonlyMap<string, typeof workLocationAssertion.$inferSelect>,
): Promise<ProjectionChange | null> {
  const row = existingByKey.get(item.key);
  if (row && projectionMatches(row, item)) return null;
  if (row) {
    await database
      .update(workLocationAssertion)
      .set({
        placeId: item.placeId,
        schedule: item.schedule,
        sourcePlanVersionId: item.planVersionId,
        revision: row.revision + 1,
        archivedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(workLocationAssertion.id, row.id));
    return [row.id, 'update'];
  }
  const created = (
    await database
      .insert(workLocationAssertion)
      .values({
        hubId,
        placeId: item.placeId,
        schedule: item.schedule,
        origin: 'docket',
        originProvider: 'schedule_plan',
        sourcePlanVersionId: item.planVersionId,
        sourcePlanKey: item.key,
        revision: item.revision,
      })
      .returning({ id: workLocationAssertion.id })
  )[0];
  if (!created) throw new Error('Work-schedule projection assertion was not created');
  return [created.id, 'create'];
}

/** Archive generated assertions that no longer belong in the mutable projection window. */
async function retireStaleProjections(options: {
  readonly database: Database;
  readonly hubId: string;
  readonly existing: readonly (typeof workLocationAssertion.$inferSelect)[];
  readonly desiredKeys: ReadonlySet<string>;
  readonly window: WorkScheduleProjectionWindow;
  readonly changed: Map<string, 'create' | 'update'>;
}): Promise<number> {
  let retired = 0;
  for (const row of options.existing) {
    if (
      options.desiredKeys.has(row.sourcePlanKey ?? '') ||
      !staleProjectionIsMutable(row, options.window)
    ) {
      continue;
    }
    const archived = await archiveWorkLocationAssertion(options.database, options.hubId, row.id);
    await enqueueWorkLocationProjection(options.database, options.hubId, archived, 'delete');
    options.changed.delete(row.id);
    retired += 1;
  }
  return retired;
}

/** Enqueue every changed compatibility assertion after its canonical row is readable. */
async function enqueueChangedProjections(
  database: Database,
  hubId: string,
  changed: ReadonlyMap<string, 'create' | 'update'>,
): Promise<void> {
  if (changed.size === 0) return;
  const assertions = await listWorkLocationAssertions(database, hubId);
  for (const [id, operation] of changed) {
    const assertion = assertions.items.find((candidate) => candidate.id === id);
    if (!assertion) throw new Error('Generated work-schedule assertion was not readable');
    await enqueueWorkLocationProjection(database, hubId, assertion, operation);
  }
}

/**
 * Reconcile one bounded canonical plan window into the existing provider assertion outbox.
 *
 * @remarks
 * Generated assertions are compatibility projections. The plan remains authoritative, and the
 * expected-location resolver reads it before these rows. Stable source keys make repeated sweeps
 * idempotent while the existing retry and provider-binding machinery delivers the writes.
 *
 * @param database - The database connection.
 * @param hubId - The caller-owned personal Hub.
 * @param window - Optional explicit civil-date window. The sweep normally supplies ninety days.
 * @returns The number of generated assertions created, changed, or retired.
 */
export async function refreshWorkScheduleProjectionAssertions(
  database: Database,
  hubId: string,
  window: WorkScheduleProjectionWindow,
): Promise<number> {
  const schedule = await listWorkSchedule(database, hubId);
  const desired = planWorkScheduleProjection({ schedule, ...window });
  const existing = await database
    .select()
    .from(workLocationAssertion)
    .where(
      and(
        eq(workLocationAssertion.hubId, hubId),
        eq(workLocationAssertion.originProvider, 'schedule_plan'),
      ),
    );
  const existingByKey = new Map(
    existing.flatMap((row) => (row.sourcePlanKey ? [[row.sourcePlanKey, row] as const] : [])),
  );
  const desiredKeys = new Set(desired.map((item) => item.key));
  const changed = new Map<string, 'create' | 'update'>();
  const activeExisting = existing.filter((row) => row.archivedAt === null);

  for (const item of desired) {
    const change = await materializeProjection(database, hubId, item, existingByKey);
    if (change) changed.set(...change);
  }

  const retired = await retireStaleProjections({
    database,
    hubId,
    existing: activeExisting,
    desiredKeys,
    window,
    changed,
  });
  await enqueueChangedProjections(database, hubId, changed);
  return changed.size + retired;
}
