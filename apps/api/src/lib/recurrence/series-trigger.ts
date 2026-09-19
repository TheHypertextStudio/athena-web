/**
 * `@docket/api` — a recurrence trigger, in the columns it is stored as and back again.
 *
 * @remarks
 * A trigger is a discriminated union — manual, completion-anchored, event-driven, or one of four
 * calendar schedules — and it is stored as one wide, mostly-null row so a sweep can select due
 * series with plain SQL rather than by decoding JSON. That trade is paid for here: writing a
 * trigger flattens it, and reading one back rebuilds the union and refuses a row whose columns do
 * not add up to a schedule anyone could execute.
 */
import type { recurrenceSeriesRevision } from '@docket/db';

import {
  ProcessTrigger,
  type CalendarRecurrenceSchedule as CalendarRecurrenceScheduleValue,
  type ProcessTrigger as ProcessTriggerValue,
} from '../../contracts/recurrence';
import { ConflictError } from '../../error';

type SeriesRevisionRow = typeof recurrenceSeriesRevision.$inferSelect;

const WEEKDAY_NUMBER = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
} as const;
const NUMBER_WEEKDAY = {
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
  7: 'sunday',
} as const;

/** Fields and selected weekdays persisted for one trigger revision. */
interface TriggerStorage {
  readonly values: Omit<
    typeof recurrenceSeriesRevision.$inferInsert,
    | 'id'
    | 'organizationId'
    | 'seriesId'
    | 'processRevisionId'
    | 'number'
    | 'effectiveFrom'
    | 'createdBy'
  >;
  readonly weekdays: readonly number[];
}

/** Convert a clock instant to a stable UTC civil date for non-calendar trigger defaults. */
export function utcCalendarDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Normalize a trigger union into relational columns and selected weekday rows. */
export function triggerStorage(trigger: ProcessTriggerValue): TriggerStorage {
  const parsed = ProcessTrigger.parse(trigger);
  if (parsed.kind === 'manual') return { values: { triggerKind: 'manual' }, weekdays: [] };
  if (parsed.kind === 'after_completion') {
    return {
      values: {
        triggerKind: 'after_completion',
        interval: parsed.interval,
        intervalUnit: parsed.unit,
      },
      weekdays: [],
    };
  }
  if (parsed.kind === 'event') {
    return {
      values: {
        triggerKind: 'event',
        eventKind: parsed.event.kind,
        eventSubjectType: parsed.event.subjectType,
        eventSource: parsed.event.source,
        eventEntityKind: parsed.event.entityKind,
      },
      weekdays: [],
    };
  }

  return calendarTriggerStorage(parsed);
}

/** The end columns one calendar schedule's stop condition writes. */
function endColumns(end: CalendarRecurrenceScheduleValue['end']) {
  if (end.kind === 'never') return { endKind: 'never' as const };
  if (end.kind === 'on_date') return { endKind: 'on_date' as const, endDate: end.date };
  return { endKind: 'after_count' as const, endCount: end.count };
}

/**
 * Flatten a calendar trigger into its columns and selected weekday rows.
 *
 * @param parsed - The parsed calendar trigger.
 * @returns The row values and weekday numbers to persist.
 */
function calendarTriggerStorage(
  parsed: Extract<ProcessTriggerValue, { kind: 'calendar' }>,
): TriggerStorage {
  const schedule = parsed.schedule;
  const common = {
    triggerKind: 'calendar' as const,
    scheduleKind: schedule.kind,
    interval: schedule.interval,
    startDate: schedule.startDate,
    timezone: schedule.timezone,
    ...endColumns(schedule.end),
    missedPolicy: parsed.missedPolicy,
    horizonDays: parsed.materialization.horizonDays,
    minimumOccurrences: parsed.materialization.minimumOccurrences,
  };
  if (schedule.kind === 'daily') return { values: common, weekdays: [] };
  if (schedule.kind === 'weekly') {
    return {
      values: common,
      weekdays: schedule.weekdays.map((weekday) => WEEKDAY_NUMBER[weekday]),
    };
  }
  if (schedule.kind === 'yearly') {
    return {
      values: {
        ...common,
        yearMonth: schedule.month,
        yearDay: schedule.day,
        overflow: schedule.overflow,
      },
      weekdays: [],
    };
  }
  return schedule.pattern.kind === 'day_of_month'
    ? {
        values: {
          ...common,
          monthlyPatternKind: 'day_of_month',
          monthDay: schedule.pattern.day,
          overflow: schedule.pattern.overflow,
        },
        weekdays: [],
      }
    : {
        values: {
          ...common,
          monthlyPatternKind: 'nth_weekday',
          nthWeekdayOrdinal: schedule.pattern.ordinal,
          nthWeekday: WEEKDAY_NUMBER[schedule.pattern.weekday],
        },
        weekdays: [],
      };
}

/** Reconstruct a canonical trigger union from one normalized revision. */
export function triggerFromStorage(
  row: SeriesRevisionRow,
  weekdayNumbers: readonly number[],
): ProcessTriggerValue {
  if (row.triggerKind === 'manual') return { kind: 'manual' };
  if (row.triggerKind === 'after_completion') {
    if (row.interval === null || row.intervalUnit === null) {
      throw new ConflictError('Completion trigger is incomplete');
    }
    return { kind: 'after_completion', interval: row.interval, unit: row.intervalUnit };
  }
  if (row.triggerKind === 'event') {
    return ProcessTrigger.parse({
      kind: 'event',
      event: {
        ...(row.eventKind === null ? {} : { kind: row.eventKind }),
        ...(row.eventSubjectType === null ? {} : { subjectType: row.eventSubjectType }),
        ...(row.eventSource === null ? {} : { source: row.eventSource }),
        ...(row.eventEntityKind === null ? {} : { entityKind: row.eventEntityKind }),
      },
    });
  }
  return ProcessTrigger.parse(calendarTriggerFromStorage(row, weekdayNumbers));
}

/**
 * Rebuild the calendar trigger one revision row stores.
 *
 * @param row - The stored trigger revision.
 * @param weekdayNumbers - The selected weekday rows, for a weekly schedule.
 * @returns The calendar trigger, before contract validation.
 * @throws {ConflictError} When the row's columns do not add up to an executable schedule.
 */
function calendarTriggerFromStorage(row: SeriesRevisionRow, weekdayNumbers: readonly number[]) {
  if (
    row.scheduleKind === null ||
    row.interval === null ||
    row.startDate === null ||
    row.timezone === null ||
    row.endKind === null ||
    row.missedPolicy === null ||
    row.horizonDays === null ||
    row.minimumOccurrences === null
  ) {
    throw new ConflictError('Calendar trigger is incomplete');
  }
  const common = {
    interval: row.interval,
    startDate: row.startDate,
    timezone: row.timezone,
    end: endFromStorage(row),
  };
  return {
    kind: 'calendar',
    schedule: scheduleFromStorage(row, weekdayNumbers, common),
    missedPolicy: row.missedPolicy,
    materialization: {
      horizonDays: row.horizonDays,
      minimumOccurrences: row.minimumOccurrences,
    },
  };
}

/**
 * Rebuild a schedule's stop condition from its columns.
 *
 * @param row - The stored trigger revision.
 * @returns The recurrence end.
 * @throws {ConflictError} When the end kind and its value disagree.
 */
function endFromStorage(row: SeriesRevisionRow): CalendarRecurrenceScheduleValue['end'] {
  if (row.endKind === 'never') return { kind: 'never' };
  if (row.endKind === 'on_date' && row.endDate !== null) {
    return { kind: 'on_date', date: row.endDate };
  }
  if (row.endKind === 'after_count' && row.endCount !== null) {
    return { kind: 'after_count', count: row.endCount };
  }
  throw new ConflictError('Calendar recurrence end is incomplete');
}

/** The interval, start, timezone, and end every calendar schedule shares. */
type ScheduleCommon = Pick<
  CalendarRecurrenceScheduleValue,
  'interval' | 'startDate' | 'timezone' | 'end'
>;

/**
 * Rebuild the schedule arm one revision row stores.
 *
 * @param row - The stored trigger revision.
 * @param weekdayNumbers - The selected weekday rows, for a weekly schedule.
 * @param common - The fields every arm shares.
 * @returns The schedule.
 * @throws {ConflictError} When the arm's own columns are incomplete.
 */
function scheduleFromStorage(
  row: SeriesRevisionRow,
  weekdayNumbers: readonly number[],
  common: ScheduleCommon,
): CalendarRecurrenceScheduleValue {
  if (row.scheduleKind === 'daily') return { kind: 'daily', ...common };
  if (row.scheduleKind === 'weekly') {
    return {
      kind: 'weekly',
      ...common,
      weekdays: weekdayNumbers.map(
        (number) => NUMBER_WEEKDAY[number as keyof typeof NUMBER_WEEKDAY],
      ),
    };
  }
  if (row.scheduleKind === 'monthly') {
    return { kind: 'monthly', ...common, pattern: monthlyPatternFromStorage(row) };
  }
  if (row.yearMonth === null || row.yearDay === null || row.overflow === null) {
    throw new ConflictError('Yearly trigger is incomplete');
  }
  return {
    kind: 'yearly',
    ...common,
    month: row.yearMonth,
    day: row.yearDay,
    overflow: row.overflow,
  };
}

/**
 * Rebuild a monthly schedule's pattern from its columns.
 *
 * @param row - The stored trigger revision.
 * @returns The monthly pattern.
 * @throws {ConflictError} When neither pattern's columns are complete.
 */
function monthlyPatternFromStorage(
  row: SeriesRevisionRow,
): Extract<CalendarRecurrenceScheduleValue, { kind: 'monthly' }>['pattern'] {
  if (row.monthlyPatternKind === 'day_of_month' && row.monthDay !== null && row.overflow !== null) {
    return { kind: 'day_of_month', day: row.monthDay, overflow: row.overflow };
  }
  if (
    row.monthlyPatternKind === 'nth_weekday' &&
    row.nthWeekdayOrdinal !== null &&
    row.nthWeekday !== null
  ) {
    return {
      kind: 'nth_weekday',
      ordinal: row.nthWeekdayOrdinal as 1 | 2 | 3 | 4 | 5 | -1,
      weekday: NUMBER_WEEKDAY[row.nthWeekday as keyof typeof NUMBER_WEEKDAY],
    };
  }
  throw new ConflictError('Monthly trigger is incomplete');
}
