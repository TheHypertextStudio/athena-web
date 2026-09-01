/**
 * `@docket/api` — bounded RRULE import/export for Docket's canonical schedule union.
 *
 * @remarks
 * RRULE is an interoperability envelope, never stored behavior. This adapter accepts only forms
 * with an exact Docket equivalent and rejects fields whose semantics would be lost or guessed.
 */
import {
  CalendarRecurrenceSchedule,
  type RecurrenceEnd,
  type RecurrenceSchedule,
  type RecurrenceWeekday,
} from '../../contracts/recurrence';

import { formatCalendarDate, parseCalendarDate } from '@docket/planning/calendar-date';

const WEEKDAY_CODE: Readonly<Record<RecurrenceWeekday, string>> = {
  monday: 'MO',
  tuesday: 'TU',
  wednesday: 'WE',
  thursday: 'TH',
  friday: 'FR',
  saturday: 'SA',
  sunday: 'SU',
};
const CODE_WEEKDAY = new Map(
  Object.entries(WEEKDAY_CODE).map(([weekday, code]) => [code, weekday as RecurrenceWeekday]),
);
const WEEKDAY_ORDER = new Map(
  Object.keys(WEEKDAY_CODE).map((weekday, index) => [weekday as RecurrenceWeekday, index]),
);

/** Portable RRULE fields plus Docket's date-only start and timezone context. */
export interface RRuleEnvelope {
  /** First eligible calendar date. */
  readonly dtstart: string;
  /** IANA timezone that gives the civil dates their planning context. */
  readonly timezone: string;
  /** RFC 5545 recurrence rule without the `RRULE:` prefix. */
  readonly rrule: string;
}

/** Ensure a timezone is recognized before accepting it at the adapter boundary. */
function assertTimezone(timezone: string): void {
  if (timezone.trim().length === 0) throw new RangeError('Timezone must not be blank');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new RangeError(`Unknown IANA timezone: ${timezone}`);
  }
}

/** Convert Docket's inclusive end union into stable RRULE fields. */
function exportEnd(end: RecurrenceEnd): string[] {
  if (end.kind === 'never') return [];
  if (end.kind === 'after_count') return [`COUNT=${end.count}`];
  return [`UNTIL=${end.date.replaceAll('-', '')}`];
}

/** Sort weekdays into canonical Monday-through-Sunday order. */
function orderedWeekdays(weekdays: readonly RecurrenceWeekday[]): RecurrenceWeekday[] {
  return [...weekdays].sort(
    (left, right) => (WEEKDAY_ORDER.get(left) ?? 0) - (WEEKDAY_ORDER.get(right) ?? 0),
  );
}

/** Export an exactly representable Docket schedule as an RRULE envelope. */
export function exportRRule(schedule: RecurrenceSchedule): RRuleEnvelope {
  if (schedule.kind === 'after_completion') {
    throw new TypeError('Completion-anchored schedules do not have RRULE semantics');
  }
  parseCalendarDate(schedule.startDate);
  assertTimezone(schedule.timezone);
  const fields: string[] = [];
  if (schedule.kind === 'daily') fields.push('FREQ=DAILY', `INTERVAL=${schedule.interval}`);
  if (schedule.kind === 'weekly') {
    fields.push(
      'FREQ=WEEKLY',
      `INTERVAL=${schedule.interval}`,
      `BYDAY=${orderedWeekdays(schedule.weekdays)
        .map((weekday) => WEEKDAY_CODE[weekday])
        .join(',')}`,
    );
  }
  if (schedule.kind === 'monthly') {
    if (schedule.pattern.kind === 'day_of_month') {
      if (schedule.pattern.overflow === 'last_day') {
        throw new TypeError('RRULE cannot preserve Docket last-day overflow behavior');
      }
      fields.push(
        'FREQ=MONTHLY',
        `INTERVAL=${schedule.interval}`,
        `BYMONTHDAY=${schedule.pattern.day}`,
      );
    } else {
      fields.push(
        'FREQ=MONTHLY',
        `INTERVAL=${schedule.interval}`,
        `BYDAY=${schedule.pattern.ordinal}${WEEKDAY_CODE[schedule.pattern.weekday]}`,
      );
    }
  }
  if (schedule.kind === 'yearly') {
    if (schedule.overflow === 'last_day') {
      throw new TypeError('RRULE cannot preserve Docket last-day overflow behavior');
    }
    fields.push(
      'FREQ=YEARLY',
      `INTERVAL=${schedule.interval}`,
      `BYMONTH=${schedule.month}`,
      `BYMONTHDAY=${schedule.day}`,
    );
  }
  fields.push(...exportEnd(schedule.end));
  return { dtstart: schedule.startDate, timezone: schedule.timezone, rrule: fields.join(';') };
}

/** Parse one positive integer RRULE field with a bounded range. */
function positiveInteger(value: string | undefined, field: string, maximum: number): number {
  if (!value || !/^\d+$/.test(value)) throw new RangeError(`${field} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new RangeError(`${field} must be between 1 and ${maximum}`);
  }
  return parsed;
}

/** Parse a date-only `UNTIL` field. */
function untilDate(value: string): string {
  if (!/^\d{8}$/.test(value)) throw new RangeError('UNTIL must be a date in YYYYMMDD form');
  const date = formatCalendarDate({
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(4, 6)),
    day: Number(value.slice(6, 8)),
  });
  parseCalendarDate(date);
  return date;
}

/** Parse COUNT or UNTIL into the canonical end union. */
function importEnd(fields: ReadonlyMap<string, string>): RecurrenceEnd {
  const count = fields.get('COUNT');
  const until = fields.get('UNTIL');
  if (count && until) throw new RangeError('RRULE cannot contain both COUNT and UNTIL');
  if (count) return { kind: 'after_count', count: positiveInteger(count, 'COUNT', 1_000_000) };
  if (until) return { kind: 'on_date', date: untilDate(until) };
  return { kind: 'never' };
}

/** Parse unique semicolon-delimited RRULE fields and reject malformed entries. */
function parseFields(rrule: string): Map<string, string> {
  const source = rrule.trim().replace(/^RRULE:/i, '');
  if (source.length === 0) throw new RangeError('RRULE must not be blank');
  const fields = new Map<string, string>();
  for (const entry of source.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 1 || separator === entry.length - 1) {
      throw new RangeError(`Malformed RRULE field: ${entry}`);
    }
    const key = entry.slice(0, separator).toUpperCase();
    const value = entry.slice(separator + 1).toUpperCase();
    if (fields.has(key)) throw new RangeError(`RRULE field ${key} appears more than once`);
    fields.set(key, value);
  }
  return fields;
}

/** Assert that every supplied field belongs to the exact supported shape. */
function assertSupportedFields(
  fields: ReadonlyMap<string, string>,
  allowed: readonly string[],
): void {
  const supported = new Set(allowed);
  const unknown = [...fields.keys()].find((key) => !supported.has(key));
  if (unknown) throw new RangeError(`Unsupported RRULE field: ${unknown}`);
}

/** Parse a comma-delimited set of non-ordinal weekday codes. */
function weeklyDays(value: string | undefined): RecurrenceWeekday[] {
  if (!value) throw new RangeError('Weekly RRULE requires BYDAY');
  const days = value.split(',').map((code) => CODE_WEEKDAY.get(code));
  if (days.some((day) => day === undefined)) {
    throw new RangeError('Weekly BYDAY must contain weekday codes such as MO or FR');
  }
  const unique = [...new Set(days as RecurrenceWeekday[])];
  if (unique.length !== days.length) throw new RangeError('Weekly BYDAY must not repeat weekdays');
  return orderedWeekdays(unique);
}

/** Import an exactly representable RRULE envelope into Docket's canonical schedule union. */
export function importRRule(envelope: RRuleEnvelope): CalendarRecurrenceSchedule {
  parseCalendarDate(envelope.dtstart);
  assertTimezone(envelope.timezone);
  const fields = parseFields(envelope.rrule);
  const frequency = fields.get('FREQ');
  const interval = fields.has('INTERVAL')
    ? positiveInteger(fields.get('INTERVAL'), 'INTERVAL', 1_000_000)
    : 1;
  const end = importEnd(fields);
  const common = {
    interval,
    startDate: envelope.dtstart,
    timezone: envelope.timezone,
    end,
  } as const;

  if (frequency === 'DAILY') {
    assertSupportedFields(fields, ['FREQ', 'INTERVAL', 'COUNT', 'UNTIL']);
    return CalendarRecurrenceSchedule.parse({ kind: 'daily', ...common });
  }
  if (frequency === 'WEEKLY') {
    assertSupportedFields(fields, ['FREQ', 'INTERVAL', 'BYDAY', 'COUNT', 'UNTIL']);
    return CalendarRecurrenceSchedule.parse({
      kind: 'weekly',
      ...common,
      weekdays: weeklyDays(fields.get('BYDAY')),
    });
  }
  if (frequency === 'MONTHLY') {
    assertSupportedFields(fields, ['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'COUNT', 'UNTIL']);
    const byDay = fields.get('BYDAY');
    const byMonthDay = fields.get('BYMONTHDAY');
    if ((byDay === undefined) === (byMonthDay === undefined)) {
      throw new RangeError('Monthly RRULE requires exactly one of BYDAY or BYMONTHDAY');
    }
    if (byMonthDay) {
      return CalendarRecurrenceSchedule.parse({
        kind: 'monthly',
        ...common,
        pattern: {
          kind: 'day_of_month',
          day: positiveInteger(byMonthDay, 'BYMONTHDAY', 31),
          overflow: 'skip',
        },
      });
    }
    const match = /^(-1|[1-5])(MO|TU|WE|TH|FR|SA|SU)$/.exec(byDay ?? '');
    if (!match) throw new RangeError('Monthly BYDAY must be one ordinal weekday such as 2SA');
    const weekdayCode = match[2];
    if (!weekdayCode) throw new RangeError('Monthly BYDAY is missing its weekday');
    return CalendarRecurrenceSchedule.parse({
      kind: 'monthly',
      ...common,
      pattern: {
        kind: 'nth_weekday',
        ordinal: Number(match[1]),
        weekday: CODE_WEEKDAY.get(weekdayCode),
      },
    });
  }
  if (frequency === 'YEARLY') {
    assertSupportedFields(fields, ['FREQ', 'INTERVAL', 'BYMONTH', 'BYMONTHDAY', 'COUNT', 'UNTIL']);
    return CalendarRecurrenceSchedule.parse({
      kind: 'yearly',
      ...common,
      month: positiveInteger(fields.get('BYMONTH'), 'BYMONTH', 12),
      day: positiveInteger(fields.get('BYMONTHDAY'), 'BYMONTHDAY', 31),
      overflow: 'skip',
    });
  }
  throw new RangeError(`Unsupported RRULE frequency: ${frequency ?? '(missing)'}`);
}
