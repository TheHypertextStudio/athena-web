/** One-time conversion from independent legacy assertions to a canonical work schedule. */
import {
  hub,
  workLocationAssertion,
  workLocationException,
  workScheduleChange,
  workScheduleException,
  workSchedulePlan,
  type Database,
} from '@docket/db';
import {
  WorkScheduleExceptionCreate,
  WorkScheduleLegacyConflictPayload,
  WorkSchedulePlanCreate,
  type WorkLocationSchedule,
  type WorkScheduleSegment,
} from '@docket/planning/work-location-contract';
import { WorkPlaceId } from '@docket/planning/ids';
import {
  addCalendarDays,
  calendarDaysBetween,
  mondayWeekdayIndex,
} from '@docket/planning/calendar-date';
import { localDateString, localMinuteOfDay, minutesBetween } from '@docket/planning/zoned-time';
import { and, eq, inArray, isNull } from 'drizzle-orm';

/** Minimal legacy assertion shape required by the pure migration planner. */
export interface LegacyScheduleAssertion {
  readonly id: string;
  readonly placeId: string;
  readonly schedule: WorkLocationSchedule;
}

/** Minimal legacy occurrence exception shape required by the pure migration planner. */
export interface LegacyScheduleException {
  readonly assertionId: string;
  readonly date: string;
  readonly action: string;
  readonly replacementPlaceId: string | null;
  readonly replacementSchedule: Extract<
    WorkLocationSchedule,
    { type: 'one_off_all_day' | 'one_off_timed' }
  > | null;
}

type LegacyMigrationConflictReason =
  'mixed_timezones' | 'incompatible_ranges' | 'orphaned_exception' | 'overlapping_segments';

/** Pure conversion result used by persistence and focused behavior tests. */
export type LegacyScheduleMigrationPlan =
  | {
      readonly status: 'ready';
      readonly plan: WorkSchedulePlanCreate;
      readonly exceptions: readonly WorkScheduleExceptionCreate[];
      readonly assertionIds: readonly string[];
    }
  | {
      readonly status: 'conflict';
      readonly reason: LegacyMigrationConflictReason;
      readonly assertionIds: readonly string[];
    };

type LegacyMigrationConflict = Extract<LegacyScheduleMigrationPlan, { status: 'conflict' }>;

interface WeeklyContributor {
  readonly assertionId: string;
  readonly segment: WorkScheduleSegment;
}

function scheduleTimezone(schedule: WorkLocationSchedule): string {
  return schedule.timezone;
}

function datedScheduleDate(
  schedule: Extract<WorkLocationSchedule, { type: 'one_off_all_day' | 'one_off_timed' }>,
): string {
  return schedule.type === 'one_off_all_day'
    ? schedule.date
    : localDateString(new Date(schedule.startsAt), schedule.timezone);
}

function scheduleSegment(schedule: WorkLocationSchedule, placeId: string): WorkScheduleSegment {
  const location = { type: 'saved_place' as const, placeId: WorkPlaceId.parse(placeId) };
  if (schedule.type === 'weekly_all_day' || schedule.type === 'one_off_all_day') {
    return { startMinute: 0, durationMinutes: 1_440, location };
  }
  if (schedule.type === 'weekly_timed') {
    return {
      startMinute: schedule.startMinute,
      durationMinutes: schedule.endMinute - schedule.startMinute,
      location,
    };
  }
  const start = new Date(schedule.startsAt);
  return {
    startMinute: localMinuteOfDay(start, schedule.timezone),
    durationMinutes: minutesBetween(start, new Date(schedule.endsAt)),
    location,
  };
}

function conflict(
  assertions: readonly LegacyScheduleAssertion[],
  reason: LegacyMigrationConflictReason,
): LegacyMigrationConflict {
  return { status: 'conflict', reason, assertionIds: assertions.map((item) => item.id) };
}

function matchingWeeklyRange(
  weekly: readonly LegacyScheduleAssertion[],
): { readonly effectiveFrom: string; readonly effectiveUntil: string | null } | null {
  const first = weekly[0]?.schedule;
  if (!first || (first.type !== 'weekly_all_day' && first.type !== 'weekly_timed')) return null;
  const matches = weekly.every((assertion) => {
    const schedule = assertion.schedule;
    return (
      (schedule.type === 'weekly_all_day' || schedule.type === 'weekly_timed') &&
      schedule.effectiveFrom === first.effectiveFrom &&
      schedule.effectiveUntil === first.effectiveUntil
    );
  });
  return matches
    ? { effectiveFrom: first.effectiveFrom, effectiveUntil: first.effectiveUntil }
    : null;
}

function sortedSegments(contributors: readonly WeeklyContributor[]): WorkScheduleSegment[] {
  return contributors
    .map((item) => item.segment)
    .sort((left, right) => left.startMinute - right.startMinute);
}

function cycleIndex(anchorDate: string, date: string): number {
  const offset = calendarDaysBetween(anchorDate, date) % 7;
  return offset < 0 ? offset + 7 : offset;
}

function appendDatedSegment(
  dates: Map<string, WorkScheduleSegment[]>,
  date: string,
  segment: WorkScheduleSegment,
): void {
  dates.set(date, [...(dates.get(date) ?? []), segment]);
}

interface LegacyOccurrenceContext {
  readonly initializedDates: Set<string>;
  readonly assertionsById: ReadonlyMap<string, LegacyScheduleAssertion>;
  readonly contributors: readonly (readonly WeeklyContributor[])[];
  readonly anchorDate: string;
}

function applyLegacyOccurrence(
  dates: Map<string, WorkScheduleSegment[]>,
  occurrence: LegacyScheduleException,
  context: LegacyOccurrenceContext,
): boolean {
  const assertion = context.assertionsById.get(occurrence.assertionId);
  if (!assertion) return false;
  const day = context.contributors[cycleIndex(context.anchorDate, occurrence.date)] ?? [];
  const current = context.initializedDates.has(occurrence.date)
    ? (dates.get(occurrence.date) ?? [])
    : [...sortedSegments(day), ...(dates.get(occurrence.date) ?? [])];
  context.initializedDates.add(occurrence.date);
  const withoutSeries = current.filter((segment) => {
    const contributor = day.find(
      (item) => item.assertionId === occurrence.assertionId && item.segment === segment,
    );
    return !contributor;
  });
  dates.set(occurrence.date, withoutSeries);
  if (
    occurrence.action === 'replace' &&
    occurrence.replacementPlaceId &&
    occurrence.replacementSchedule
  ) {
    appendDatedSegment(
      dates,
      occurrence.date,
      scheduleSegment(occurrence.replacementSchedule, occurrence.replacementPlaceId),
    );
  }
  return true;
}

interface LegacyMigrationBase {
  readonly timezone: string;
  readonly weekly: readonly LegacyScheduleAssertion[];
  readonly dated: readonly LegacyScheduleAssertion[];
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
  readonly anchorDate: string;
}

function dateFallsOutsideRange(
  range: { readonly effectiveFrom: string; readonly effectiveUntil: string | null } | null,
  date: string,
): boolean {
  if (!range) return false;
  if (date < range.effectiveFrom) return true;
  return range.effectiveUntil !== null && date > range.effectiveUntil;
}

function migrationBase(
  assertions: readonly LegacyScheduleAssertion[],
): LegacyMigrationBase | LegacyMigrationConflict {
  const timezones = new Set(assertions.map((item) => scheduleTimezone(item.schedule)));
  if (timezones.size !== 1) return conflict(assertions, 'mixed_timezones');
  const timezone = [...timezones][0];
  if (!timezone) return conflict(assertions, 'incompatible_ranges');
  const weekly = assertions.filter(
    (item) => item.schedule.type === 'weekly_all_day' || item.schedule.type === 'weekly_timed',
  );
  const dated = assertions.filter(
    (item) => item.schedule.type === 'one_off_all_day' || item.schedule.type === 'one_off_timed',
  );
  const datedDates = dated.map((item) =>
    datedScheduleDate(
      item.schedule as Extract<WorkLocationSchedule, { type: 'one_off_all_day' | 'one_off_timed' }>,
    ),
  );
  const range = matchingWeeklyRange(weekly);
  if (weekly.length > 0 && !range) {
    return conflict(assertions, 'incompatible_ranges');
  }
  const effectiveFrom = range?.effectiveFrom ?? [...datedDates].sort()[0];
  const effectiveUntil = range?.effectiveUntil ?? [...datedDates].sort().at(-1) ?? null;
  if (!effectiveFrom) return conflict(assertions, 'incompatible_ranges');
  const datedOutsideRange = datedDates.some((date) => dateFallsOutsideRange(range, date));
  if (datedOutsideRange) {
    return conflict(assertions, 'incompatible_ranges');
  }
  return {
    timezone,
    weekly,
    dated,
    effectiveFrom,
    effectiveUntil,
    anchorDate: addCalendarDays(effectiveFrom, -mondayWeekdayIndex(effectiveFrom)),
  };
}

function weeklyPlan(
  assertions: readonly LegacyScheduleAssertion[],
  base: LegacyMigrationBase,
):
  | {
      readonly plan: WorkSchedulePlanCreate;
      readonly contributors: readonly (readonly WeeklyContributor[])[];
    }
  | LegacyMigrationConflict {
  const contributors: WeeklyContributor[][] = Array.from({ length: 7 }, () => []);
  for (const assertion of base.weekly) {
    const schedule = assertion.schedule;
    if (schedule.type !== 'weekly_all_day' && schedule.type !== 'weekly_timed') continue;
    const segment = scheduleSegment(schedule, assertion.placeId);
    for (const weekday of schedule.weekdays) {
      contributors[weekday]?.push({ assertionId: assertion.id, segment });
    }
  }
  const plan = WorkSchedulePlanCreate.safeParse({
    anchorDate: base.anchorDate,
    timezone: base.timezone,
    effectiveFrom: base.effectiveFrom,
    effectiveUntil: base.effectiveUntil,
    cycleDays: contributors.map((day) => ({ segments: sortedSegments(day) })),
  });
  return plan.success
    ? { plan: plan.data, contributors }
    : conflict(assertions, 'overlapping_segments');
}

function datedReplacements(
  assertions: readonly LegacyScheduleAssertion[],
  occurrences: readonly LegacyScheduleException[],
  base: LegacyMigrationBase,
  contributors: readonly (readonly WeeklyContributor[])[],
): WorkScheduleExceptionCreate[] | LegacyMigrationConflict {
  const dates = new Map<string, WorkScheduleSegment[]>();
  const initializedOccurrenceDates = new Set<string>();
  for (const assertion of base.dated) {
    const schedule = assertion.schedule;
    if (schedule.type !== 'one_off_all_day' && schedule.type !== 'one_off_timed') continue;
    appendDatedSegment(
      dates,
      datedScheduleDate(schedule),
      scheduleSegment(schedule, assertion.placeId),
    );
  }
  const assertionsById = new Map(assertions.map((item) => [item.id, item]));
  const occurrenceContext: LegacyOccurrenceContext = {
    initializedDates: initializedOccurrenceDates,
    assertionsById,
    contributors,
    anchorDate: base.anchorDate,
  };
  for (const occurrence of occurrences) {
    if (!applyLegacyOccurrence(dates, occurrence, occurrenceContext)) {
      return conflict(assertions, 'orphaned_exception');
    }
  }
  const exceptions: WorkScheduleExceptionCreate[] = [];
  for (const [date, segments] of [...dates].sort(([left], [right]) => left.localeCompare(right))) {
    const parsed = WorkScheduleExceptionCreate.safeParse({
      date,
      segments: [...segments].sort((left, right) => left.startMinute - right.startMinute),
    });
    if (!parsed.success) {
      return conflict(assertions, 'overlapping_segments');
    }
    exceptions.push(parsed.data);
  }
  return exceptions;
}

/** Convert compatible legacy assertions without guessing through overlap or timezone conflicts. */
export function planLegacyWorkScheduleMigration(
  assertions: readonly LegacyScheduleAssertion[],
  occurrences: readonly LegacyScheduleException[],
): LegacyScheduleMigrationPlan {
  const base = migrationBase(assertions);
  if ('status' in base) return base;
  const weekly = weeklyPlan(assertions, base);
  if ('status' in weekly) return weekly;
  const exceptions = datedReplacements(assertions, occurrences, base, weekly.contributors);
  if (!Array.isArray(exceptions)) return exceptions;
  return {
    status: 'ready',
    plan: weekly.plan,
    exceptions,
    assertionIds: assertions.map((item) => item.id),
  };
}

async function recordLegacyConflict(
  database: Database | Parameters<Parameters<Database['transaction']>[0]>[0],
  hubId: string,
  result: Extract<LegacyScheduleMigrationPlan, { status: 'conflict' }>,
): Promise<void> {
  const existing = await database
    .select({ id: workScheduleChange.id })
    .from(workScheduleChange)
    .where(
      and(
        eq(workScheduleChange.hubId, hubId),
        eq(workScheduleChange.kind, 'legacy_conflict'),
        eq(workScheduleChange.state, 'pending'),
      ),
    )
    .limit(1);
  if (existing[0]) return;
  await database.insert(workScheduleChange).values({
    hubId,
    connectionId: null,
    provider: null,
    kind: 'legacy_conflict',
    state: 'pending',
    dedupeKey: 'legacy:active-assertions',
    payload: WorkScheduleLegacyConflictPayload.parse({
      kind: 'legacy_conflict',
      reason: result.reason,
      assertionIds: result.assertionIds,
    }),
  });
}

/** Convert a Hub's active legacy assertions once, or queue one explicit conflict decision. */
export async function migrateLegacyWorkSchedule(
  database: Database,
  hubId: string,
): Promise<'migrated' | 'conflict' | 'unchanged'> {
  return database.transaction(async (tx) => {
    const owner = await tx
      .select({ id: hub.id })
      .from(hub)
      .where(eq(hub.id, hubId))
      .limit(1)
      .for('update');
    if (!owner[0]) return 'unchanged';
    const existingPlans = await tx
      .select({ id: workSchedulePlan.id })
      .from(workSchedulePlan)
      .where(eq(workSchedulePlan.hubId, hubId))
      .limit(1);
    if (existingPlans[0]) return 'unchanged';
    const rows = await tx
      .select()
      .from(workLocationAssertion)
      .where(
        and(
          eq(workLocationAssertion.hubId, hubId),
          isNull(workLocationAssertion.archivedAt),
          isNull(workLocationAssertion.sourcePlanVersionId),
        ),
      );
    const assertions = rows.filter((row) => row.originProvider !== 'schedule_plan');
    if (assertions.length === 0) return 'unchanged';
    const assertionIds = assertions.map((row) => row.id);
    const occurrences = await tx
      .select()
      .from(workLocationException)
      .where(inArray(workLocationException.assertionId, assertionIds));
    const result = planLegacyWorkScheduleMigration(assertions, occurrences);
    if (result.status === 'conflict') {
      await recordLegacyConflict(tx, hubId, result);
      return 'conflict';
    }
    const now = new Date();
    const plan = (
      await tx
        .insert(workSchedulePlan)
        .values({ hubId, ...result.plan })
        .returning({ id: workSchedulePlan.id })
    )[0];
    if (!plan) throw new Error('Legacy work schedule plan was not created');
    if (result.exceptions.length > 0) {
      await tx.insert(workScheduleException).values(
        result.exceptions.map((exception) => ({
          hubId,
          planVersionId: plan.id,
          date: exception.date,
          segments: exception.segments,
          origin: 'docket',
        })),
      );
    }
    await tx
      .update(workLocationAssertion)
      .set({ sourcePlanVersionId: plan.id, archivedAt: now, updatedAt: now })
      .where(
        and(
          eq(workLocationAssertion.hubId, hubId),
          inArray(workLocationAssertion.id, result.assertionIds),
        ),
      );
    return 'migrated';
  });
}
