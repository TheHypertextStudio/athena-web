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
} from '../../contracts/recurrence';

import {
  addCalendarDays,
  addCalendarMonths,
  compareCalendarDates,
  daysInMonth,
  formatCalendarDate,
  mondayWeekdayIndex,
  parseCalendarDate,
} from '@docket/planning/calendar-date';

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

/** Every date a daily cadence names, in order. */
function* dailyCandidates(
  schedule: Extract<CalendarRecurrenceSchedule, { kind: 'daily' }>,
): Generator<string> {
  for (let index = 0; ; index += 1) {
    yield addCalendarDays(schedule.startDate, index * schedule.interval);
  }
}

/** Every date a weekly cadence names, in order, across its selected weekdays. */
function* weeklyCandidates(
  schedule: Extract<CalendarRecurrenceSchedule, { kind: 'weekly' }>,
): Generator<string> {
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

/** Every date a monthly cadence names, in order, skipping months its pattern misses. */
function* monthlyCandidates(
  schedule: Extract<CalendarRecurrenceSchedule, { kind: 'monthly' }>,
): Generator<string> {
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

/**
 * Every date a yearly cadence names, in order.
 *
 * @remarks
 * A February 29th that skips on overflow names no date at all, so the stream ends immediately
 * rather than looping to the year limit finding nothing.
 *
 * @param schedule - The yearly schedule.
 * @yields Each candidate date.
 */
function* yearlyCandidates(
  schedule: Extract<CalendarRecurrenceSchedule, { kind: 'yearly' }>,
): Generator<string> {
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

/** Infinite ordered candidate stream for a validated calendar schedule. */
function scheduleCandidates(schedule: CalendarRecurrenceSchedule): Generator<string> {
  assertInterval(schedule.interval);
  parseCalendarDate(schedule.startDate);
  switch (schedule.kind) {
    case 'daily':
      return dailyCandidates(schedule);
    case 'weekly':
      return weeklyCandidates(schedule);
    case 'monthly':
      return monthlyCandidates(schedule);
    default:
      return yearlyCandidates(schedule);
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

/**
 * The date one candidate actually lands on, after exclusions and reschedules.
 *
 * @param candidate - The date the schedule named.
 * @param from - The window's inclusive start.
 * @param exceptions - The normalized one-off exceptions.
 * @returns The date to emit, or `null` when this candidate produces none.
 */
function resolvedDate(
  candidate: string,
  from: string,
  exceptions: ReturnType<typeof normalizeExceptions>,
): string | null {
  if (compareCalendarDates(candidate, from) < 0) return null;
  if (exceptions.exclude.has(candidate)) return null;
  const resolved = exceptions.reschedule.get(candidate) ?? candidate;
  return compareCalendarDates(resolved, from) < 0 ? null : resolved;
}

/**
 * Check an expansion window's bounds and minimum.
 *
 * @param window - The requested window.
 * @returns The minimum occurrence count, defaulted to zero.
 * @throws {RangeError} When the bounds are reversed or the minimum is not a count.
 */
function validatedWindow(window: RecurrenceExpansionWindow): number {
  parseCalendarDate(window.from);
  parseCalendarDate(window.through);
  if (compareCalendarDates(window.from, window.through) > 0) {
    throw new RangeError('Recurrence expansion start must not follow its horizon');
  }
  const minimum = window.minimumOccurrences ?? 0;
  if (!Number.isSafeInteger(minimum) || minimum < 0) {
    throw new RangeError('Minimum occurrence count must be a nonnegative safe integer');
  }
  return minimum;
}

/**
 * Whether the series' own stop condition has been reached.
 *
 * @remarks
 * Counted against the schedule's *expected* dates rather than the ones this window emits, so
 * "after twelve occurrences" means twelve occurrences of the series, not twelve rows on one page.
 *
 * @param end - The schedule's stop condition.
 * @param candidate - The date about to be considered.
 * @param expectedCount - How many expected dates the stream has produced so far.
 * @returns `true` when the stream should stop.
 */
function seriesEnded(
  end: CalendarRecurrenceSchedule['end'],
  candidate: string,
  expectedCount: number,
): boolean {
  if (end.kind === 'after_count') return expectedCount >= end.count;
  if (end.kind === 'on_date') return compareCalendarDates(candidate, end.date) > 0;
  return false;
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
  const minimum = validatedWindow(window);
  const exceptions = normalizeExceptions(window.exceptions);
  const output = new Set<string>();
  let effectiveThrough = window.through;
  addIncludedDates(output, exceptions.include, window.from, effectiveThrough);
  let expectedCount = 0;

  /** Push the horizon out to `date` and pick up any explicit dates that now fall inside it. */
  const extendThrough = (date: string): void => {
    effectiveThrough = date;
    addIncludedDates(output, exceptions.include, window.from, effectiveThrough);
  };

  for (const candidate of scheduleCandidates(schedule)) {
    if (seriesEnded(schedule.end, candidate, expectedCount)) break;
    expectedCount += 1;

    if (compareCalendarDates(candidate, effectiveThrough) > 0) {
      // Past the horizon and the window is satisfied; otherwise keep going until it is.
      if (output.size >= minimum) break;
      extendThrough(candidate);
    }
    const resolved = resolvedDate(candidate, window.from, exceptions);
    if (resolved === null) continue;
    output.add(resolved);
    if (compareCalendarDates(resolved, effectiveThrough) > 0) extendThrough(resolved);
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
