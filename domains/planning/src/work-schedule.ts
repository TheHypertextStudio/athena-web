/** Pure expansion of one repeating work-schedule plan into dated local-time segments. */
import type {
  WorkScheduleExceptionOut,
  WorkSchedulePlanOut,
  WorkScheduleSegmentLocation,
} from './contracts/work-location';

import { addCalendarDays, calendarDaysBetween, compareCalendarDates } from './calendar-date';
import { instantAt, localDateString } from './zoned-time';

/** Select the plan in effect at one instant, or the first plan that has not started yet. */
export function selectCurrentOrNextWorkSchedulePlan(
  plans: readonly WorkSchedulePlanOut[],
  instant: Date,
): WorkSchedulePlanOut | null {
  const active = plans
    .filter((plan) => {
      const date = localDateString(instant, plan.timezone);
      return (
        plan.effectiveFrom <= date && (plan.effectiveUntil === null || plan.effectiveUntil >= date)
      );
    })
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0];
  if (active) return active;
  return (
    plans
      .filter((plan) => plan.effectiveFrom > localDateString(instant, plan.timezone))
      .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))[0] ?? null
  );
}

/** One expanded scheduled segment with exact instant boundaries. */
export interface ExpandedWorkScheduleSegment {
  /** Inclusive segment start. */
  readonly startsAt: string;
  /** Exclusive segment end. */
  readonly endsAt: string;
  /** The person's location decision for this segment. */
  readonly location: WorkScheduleSegmentLocation;
}

/** One civil date covered by a plan version, including explicit days off. */
export interface ExpandedWorkScheduleDay {
  /** Civil date in the plan timezone. */
  readonly date: string;
  /** Whether the segments came from the repeating plan or a dated replacement. */
  readonly source: 'plan' | 'exception';
  /** Plan version that governs the date. */
  readonly planVersionId: string;
  /** Dated replacement that governs the date, when one exists. */
  readonly exceptionId: string | null;
  /** Ordered work segments. An empty list means the person does not work on this date. */
  readonly segments: readonly ExpandedWorkScheduleSegment[];
}

/** Inputs for expanding one plan across an inclusive civil-date range. */
export interface ExpandWorkSchedulePlanInput {
  /** Plan version to expand. */
  readonly plan: WorkSchedulePlanOut;
  /** Dated replacements that belong to this plan version. */
  readonly exceptions: readonly WorkScheduleExceptionOut[];
  /** Inclusive first civil date requested. */
  readonly startDate: string;
  /** Inclusive final civil date requested. */
  readonly endDate: string;
}

/** Return a positive modulo for dates before the plan anchor. */
function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/** Intersect a requested range with one plan version's effective dates. */
function effectiveRange(input: ExpandWorkSchedulePlanInput): {
  readonly firstDate: string;
  readonly lastDate: string;
} | null {
  const firstDate =
    compareCalendarDates(input.startDate, input.plan.effectiveFrom) < 0
      ? input.plan.effectiveFrom
      : input.startDate;
  const lastDate =
    input.plan.effectiveUntil !== null &&
    compareCalendarDates(input.endDate, input.plan.effectiveUntil) > 0
      ? input.plan.effectiveUntil
      : input.endDate;
  return compareCalendarDates(lastDate, firstDate) < 0 ? null : { firstDate, lastDate };
}

/** Expand one governed civil date from either its cycle day or complete replacement. */
function expandScheduleDay(
  input: ExpandWorkSchedulePlanInput,
  exceptions: ReadonlyMap<string, WorkScheduleExceptionOut>,
  date: string,
): ExpandedWorkScheduleDay {
  const exception = exceptions.get(date);
  const cycleIndex = positiveModulo(
    calendarDaysBetween(input.plan.anchorDate, date),
    input.plan.cycleDays.length,
  );
  const segments = exception?.segments ?? input.plan.cycleDays[cycleIndex]?.segments ?? [];
  return {
    date,
    source: exception ? 'exception' : 'plan',
    planVersionId: input.plan.id,
    exceptionId: exception?.id ?? null,
    segments: segments.map((segment) => ({
      startsAt: instantAt(date, segment.startMinute, input.plan.timezone).toISOString(),
      endsAt: instantAt(
        date,
        segment.startMinute + segment.durationMinutes,
        input.plan.timezone,
      ).toISOString(),
      location: segment.location,
    })),
  };
}

/**
 * Expand one plan into complete civil days.
 *
 * @param input - The plan, its dated replacements, and inclusive date range.
 * @returns Every governed date in order. Empty segment lists preserve explicit days off.
 */
export function expandWorkSchedulePlan(
  input: ExpandWorkSchedulePlanInput,
): ExpandedWorkScheduleDay[] {
  if (compareCalendarDates(input.endDate, input.startDate) < 0) {
    throw new RangeError('Work-schedule expansion cannot end before it starts');
  }
  const range = effectiveRange(input);
  if (!range) return [];

  const exceptions = new Map(
    input.exceptions
      .filter((exception) => exception.planVersionId === input.plan.id)
      .map((exception) => [exception.date, exception] as const),
  );
  const days: ExpandedWorkScheduleDay[] = [];
  for (
    let date = range.firstDate;
    compareCalendarDates(date, range.lastDate) <= 0;
    date = addCalendarDays(date, 1)
  ) {
    days.push(expandScheduleDay(input, exceptions, date));
  }
  return days;
}
