/**
 * `@docket/api` — pure recurrence expansion and rolling materialization-window behavior.
 *
 * @remarks
 * This module owns Docket's canonical calendar semantics. It emits expected civil dates only;
 * persistence, task creation, missed-work transitions, and timezone-to-instant conversion happen
 * at higher layers. Expansion is deterministic and safe to repeat during previews or sweeps.
 */
import type {
  CalendarRecurrenceSchedule,
  MaterializationPolicy,
  RecurrenceSchedule,
  RecurrenceWeekday,
} from '@docket/types';

import {
  addCalendarDays,
  addCalendarMonths,
  compareCalendarDates,
  daysInMonth,
  formatCalendarDate,
  mondayWeekdayIndex,
  parseCalendarDate,
} from './calendar-date';

const WEEKDAY_INDEX: Readonly<Record<RecurrenceWeekday, number>> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

/** Move one expected occurrence to a replacement calendar date. */
export interface RecurrenceDateReschedule {
  /** Original expected date. */
  readonly from: string;
  /** Replacement date. */
  readonly to: string;
}

/** Date-level exceptions applied after the canonical schedule is expanded. */
export interface RecurrenceDateExceptions {
  /** Expected dates omitted from this expansion. */
  readonly exclude?: readonly string[];
  /** Explicit additional dates, used for one-off occurrences. */
  readonly include?: readonly string[];
  /** Expected dates replaced with new dates. */
  readonly reschedule?: readonly RecurrenceDateReschedule[];
}

/** Bounds and exception context for one deterministic expansion. */
export interface RecurrenceExpansionWindow {
  /** Inclusive first date returned. */
  readonly from: string;
  /** Inclusive nominal horizon. */
  readonly through: string;
  /** Extend past `through` until this many dates are visible, unless the series ends first. */
  readonly minimumOccurrences?: number;
  /** One-off edits layered over the canonical cadence. */
  readonly exceptions?: RecurrenceDateExceptions;
}

/** A rolling materialization window derived from the series policy. */
export interface RecurrenceMaterializationWindow {
  /** Inclusive materialization start. */
  readonly from: string;
  /** Inclusive nominal materialization horizon. */
  readonly through: string;
  /** Minimum visible occurrence count. */
  readonly minimumOccurrences: number;
}

/** Validate a positive interval before it participates in unbounded generation. */
function assertInterval(interval: number): void {
  if (!Number.isSafeInteger(interval) || interval < 1) {
    throw new RangeError('Recurrence interval must be a positive safe integer');
  }
}

/** Resolve a numbered monthly date under the schedule's overflow policy. */
function numberedMonthDate(
  year: number,
  month: number,
  day: number,
  overflow: 'skip' | 'last_day',
): string | null {
  const lastDay = daysInMonth(year, month);
  if (day > lastDay && overflow === 'skip') return null;
  return formatCalendarDate({ year, month, day: Math.min(day, lastDay) });
}

/** Resolve an ordinal weekday within a month, or null when a fifth weekday does not exist. */
function ordinalWeekdayDate(
  year: number,
  month: number,
  ordinal: 1 | 2 | 3 | 4 | 5 | -1,
  weekday: RecurrenceWeekday,
): string | null {
  const target = WEEKDAY_INDEX[weekday];
  const lastDay = daysInMonth(year, month);
  if (ordinal === -1) {
    const lastDate = formatCalendarDate({ year, month, day: lastDay });
    const delta = (mondayWeekdayIndex(lastDate) - target + 7) % 7;
    return formatCalendarDate({ year, month, day: lastDay - delta });
  }
  const firstDate = formatCalendarDate({ year, month, day: 1 });
  const delta = (target - mondayWeekdayIndex(firstDate) + 7) % 7;
  const day = 1 + delta + (ordinal - 1) * 7;
  return day <= lastDay ? formatCalendarDate({ year, month, day }) : null;
}

/** Infinite ordered candidate stream for a validated calendar schedule. */
function* scheduleCandidates(schedule: CalendarRecurrenceSchedule): Generator<string> {
  assertInterval(schedule.interval);
  parseCalendarDate(schedule.startDate);

  if (schedule.kind === 'daily') {
    for (let index = 0; ; index += 1) {
      yield addCalendarDays(schedule.startDate, index * schedule.interval);
    }
  }

  if (schedule.kind === 'weekly') {
    const startWeek = addCalendarDays(schedule.startDate, -mondayWeekdayIndex(schedule.startDate));
    const weekdays = [...new Set(schedule.weekdays.map((day) => WEEKDAY_INDEX[day]))].sort(
      (left, right) => left - right,
    );
    for (let week = 0; ; week += schedule.interval) {
      for (const weekday of weekdays) {
        const candidate = addCalendarDays(startWeek, week * 7 + weekday);
        if (compareCalendarDates(candidate, schedule.startDate) >= 0) yield candidate;
      }
    }
  }

  if (schedule.kind === 'monthly') {
    for (let monthOffset = 0; ; monthOffset += schedule.interval) {
      const month = addCalendarMonths(schedule.startDate, monthOffset);
      const candidate =
        schedule.pattern.kind === 'day_of_month'
          ? numberedMonthDate(
              month.year,
              month.month,
              schedule.pattern.day,
              schedule.pattern.overflow,
            )
          : ordinalWeekdayDate(
              month.year,
              month.month,
              schedule.pattern.ordinal,
              schedule.pattern.weekday,
            );
      if (candidate && compareCalendarDates(candidate, schedule.startDate) >= 0) yield candidate;
    }
  }

  const start = parseCalendarDate(schedule.startDate);
  const maximumPossibleDay = schedule.month === 2 ? 29 : daysInMonth(2000, schedule.month);
  if (schedule.overflow === 'skip' && schedule.day > maximumPossibleDay) return;
  for (let yearOffset = 0; ; yearOffset += schedule.interval) {
    const year = start.year + yearOffset;
    if (year > 9999) return;
    const candidate = numberedMonthDate(year, schedule.month, schedule.day, schedule.overflow);
    if (candidate && compareCalendarDates(candidate, schedule.startDate) >= 0) yield candidate;
  }
}

/** Normalize and validate exception dates while rejecting ambiguous replacement sources. */
function normalizeExceptions(exceptions: RecurrenceDateExceptions | undefined): {
  readonly exclude: ReadonlySet<string>;
  readonly include: ReadonlySet<string>;
  readonly reschedule: ReadonlyMap<string, string>;
} {
  const exclude = new Set(exceptions?.exclude ?? []);
  const include = new Set(exceptions?.include ?? []);
  const reschedule = new Map<string, string>();
  for (const value of [...exclude, ...include]) parseCalendarDate(value);
  for (const replacement of exceptions?.reschedule ?? []) {
    parseCalendarDate(replacement.from);
    parseCalendarDate(replacement.to);
    if (reschedule.has(replacement.from)) {
      throw new RangeError(`Occurrence ${replacement.from} has more than one reschedule`);
    }
    if (exclude.has(replacement.from)) {
      throw new RangeError(`Occurrence ${replacement.from} cannot be excluded and rescheduled`);
    }
    reschedule.set(replacement.from, replacement.to);
  }
  return { exclude, include, reschedule };
}

/** Add explicit dates through the current effective horizon. */
function addIncludedDates(
  output: Set<string>,
  include: ReadonlySet<string>,
  from: string,
  through: string,
): void {
  for (const date of include) {
    if (compareCalendarDates(date, from) >= 0 && compareCalendarDates(date, through) <= 0) {
      output.add(date);
    }
  }
}

/**
 * Expand a canonical calendar recurrence into sorted, unique calendar dates.
 *
 * @param schedule - Calendar cadence to expand. Completion-anchored schedules are rejected.
 * @param window - Inclusive bounds, minimum count, and one-off exceptions.
 * @returns Sorted dates after exclusions, inclusions, reschedules, and series-end constraints.
 */
export function expandCalendarSchedule(
  schedule: RecurrenceSchedule,
  window: RecurrenceExpansionWindow,
): string[] {
  if (schedule.kind === 'after_completion') {
    throw new TypeError('Completion-anchored schedules advance from a completion event');
  }
  parseCalendarDate(window.from);
  parseCalendarDate(window.through);
  if (compareCalendarDates(window.from, window.through) > 0) {
    throw new RangeError('Recurrence expansion start must not follow its horizon');
  }
  const minimum = window.minimumOccurrences ?? 0;
  if (!Number.isSafeInteger(minimum) || minimum < 0) {
    throw new RangeError('Minimum occurrence count must be a nonnegative safe integer');
  }

  const exceptions = normalizeExceptions(window.exceptions);
  const output = new Set<string>();
  let effectiveThrough = window.through;
  addIncludedDates(output, exceptions.include, window.from, effectiveThrough);
  let expectedCount = 0;

  for (const candidate of scheduleCandidates(schedule)) {
    if (schedule.end.kind === 'after_count' && expectedCount >= schedule.end.count) break;
    if (schedule.end.kind === 'on_date' && compareCalendarDates(candidate, schedule.end.date) > 0) {
      break;
    }
    expectedCount += 1;

    if (compareCalendarDates(candidate, effectiveThrough) > 0) {
      if (output.size >= minimum) break;
      effectiveThrough = candidate;
      addIncludedDates(output, exceptions.include, window.from, effectiveThrough);
    }
    if (compareCalendarDates(candidate, window.from) < 0) continue;
    if (exceptions.exclude.has(candidate)) continue;

    const resolved = exceptions.reschedule.get(candidate) ?? candidate;
    if (compareCalendarDates(resolved, window.from) < 0) continue;
    output.add(resolved);
    if (compareCalendarDates(resolved, effectiveThrough) > 0) {
      effectiveThrough = resolved;
      addIncludedDates(output, exceptions.include, window.from, effectiveThrough);
    }
  }

  return [...output].sort(compareCalendarDates);
}

/** Derive the nominal rolling window used by recurrence materialization sweeps. */
export function materializationWindow(
  asOf: string,
  policy: MaterializationPolicy,
): RecurrenceMaterializationWindow {
  parseCalendarDate(asOf);
  if (!Number.isSafeInteger(policy.horizonDays) || policy.horizonDays < 1) {
    throw new RangeError('Materialization horizon must be a positive safe integer');
  }
  if (!Number.isSafeInteger(policy.minimumOccurrences) || policy.minimumOccurrences < 1) {
    throw new RangeError('Materialization minimum must be a positive safe integer');
  }
  return {
    from: asOf,
    through: addCalendarDays(asOf, policy.horizonDays),
    minimumOccurrences: policy.minimumOccurrences,
  };
}
