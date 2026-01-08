/**
 * Recurrence service for handling RRULE-based recurring tasks and events.
 *
 * Provides utilities for validating, building, and parsing RRULE strings
 * (RFC 5545 compliant).
 *
 * @packageDocumentation
 */

import { RRule as RRuleImport, rrulestr as rrulestrImport } from 'rrule';

interface RRuleOptions {
  dtstart?: Date;
  freq?: number;
  interval?: number;
  wkst?: number;
  count?: number;
  until?: Date;
  bysetpos?: number | number[];
  bymonth?: number | number[];
  bymonthday?: number | number[];
  byyearday?: number | number[];
  byweekno?: number | number[];
  byweekday?: number | number[];
  byhour?: number | number[];
  byminute?: number | number[];
  bysecond?: number | number[];
}

interface RRuleInstance {
  origOptions: RRuleOptions;
  options: RRuleOptions;
  all: (iterator?: (date: Date, index: number) => boolean) => Date[];
  between: (after: Date, before: Date, inc?: boolean) => Date[];
  after: (date: Date, inc?: boolean) => Date | null;
}

type RRuleConstructor = new (options: RRuleOptions) => RRuleInstance;

type RRuleParser = (rruleString: string) => RRuleInstance;

const RRule = RRuleImport as unknown as RRuleConstructor;
const rrulestr = rrulestrImport as unknown as RRuleParser;

/**
 * Validate an RRULE string.
 *
 * @returns Error message if invalid, null if valid
 */
export function validateRRule(rruleString: string): string | null {
  // Basic validation
  if (!rruleString.includes('FREQ=')) {
    return 'RRULE must contain FREQ parameter';
  }

  const validFreqs = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY', 'HOURLY', 'MINUTELY', 'SECONDLY'];
  const hasValidFreq = validFreqs.some((freq) => rruleString.includes(`FREQ=${freq}`));
  if (!hasValidFreq) {
    return 'Invalid FREQ value';
  }

  // Full validation with rrule library
  try {
    const normalized = rruleString.startsWith('RRULE:') ? rruleString : `RRULE:${rruleString}`;
    rrulestr(normalized);
  } catch (error: unknown) {
    return error instanceof Error ? error.message : 'Invalid RRULE format';
  }

  return null;
}

/**
 * Get the next N occurrences of a recurring rule from a given start date.
 */
export function getNextOccurrences(rruleString: string, startDate: Date, count = 10): Date[] {
  const normalized = rruleString.startsWith('RRULE:') ? rruleString : `RRULE:${rruleString}`;

  const rule = rrulestr(normalized);
  const ruleWithStart = new RRule({
    ...rule.options,
    dtstart: rule.options.dtstart ?? startDate,
  });

  return ruleWithStart.all((_date: Date, i: number) => i < count);
}

/**
 * Get all occurrences between two dates.
 */
export function getOccurrencesBetween(
  rruleString: string,
  startDate: Date,
  endDate: Date,
  dtstart?: Date,
): Date[] {
  const normalized = rruleString.startsWith('RRULE:') ? rruleString : `RRULE:${rruleString}`;

  const rule = rrulestr(normalized);
  const ruleWithStart = new RRule({
    ...rule.options,
    dtstart: dtstart ?? rule.options.dtstart ?? startDate,
  });

  return ruleWithStart.between(startDate, endDate, true);
}

/**
 * Get the next occurrence after a given date.
 */
export function getNextOccurrence(
  rruleString: string,
  afterDate: Date,
  dtstart?: Date,
): Date | null {
  const normalized = rruleString.startsWith('RRULE:') ? rruleString : `RRULE:${rruleString}`;

  const rule = rrulestr(normalized);
  const ruleWithStart = new RRule({
    ...rule.options,
    dtstart: dtstart ?? rule.options.dtstart ?? afterDate,
  });

  return ruleWithStart.after(afterDate, false);
}

/**
 * Common RRULE presets for quick creation.
 */
export const RRULE_PRESETS = {
  /** Every day */
  DAILY: 'FREQ=DAILY',

  /** Every weekday (Monday-Friday) */
  WEEKDAYS: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',

  /** Every week on the same day */
  WEEKLY: 'FREQ=WEEKLY',

  /** Every 2 weeks on the same day */
  BIWEEKLY: 'FREQ=WEEKLY;INTERVAL=2',

  /** Every month on the same date */
  MONTHLY: 'FREQ=MONTHLY',

  /** Every year on the same date */
  YEARLY: 'FREQ=YEARLY',
} as const;

/**
 * Human-readable description of an RRULE.
 */
export function describeRRule(rruleString: string): string {
  const parsed = parseRRuleBasic(rruleString);

  if (!parsed.frequency) return 'Custom recurrence';

  switch (parsed.frequency) {
    case 'DAILY':
      return parsed.interval > 1 ? `Every ${String(parsed.interval)} days` : 'Daily';
    case 'WEEKLY':
      if (parsed.byDay.length > 0) {
        const days = parsed.byDay.join(', ');
        return `Weekly on ${days}`;
      }
      return parsed.interval > 1 ? `Every ${String(parsed.interval)} weeks` : 'Weekly';
    case 'MONTHLY':
      return parsed.interval > 1 ? `Every ${String(parsed.interval)} months` : 'Monthly';
    case 'YEARLY':
      return parsed.interval > 1 ? `Every ${String(parsed.interval)} years` : 'Yearly';
    default:
      return 'Custom recurrence';
  }
}

/**
 * Build an RRULE string from common parameters.
 */
export function buildRRule(options: {
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval?: number;
  byDay?: string[];
  byMonthDay?: number[];
  byMonth?: number[];
  count?: number;
  until?: Date;
}): string {
  const parts: string[] = [`FREQ=${options.frequency}`];

  if (options.interval && options.interval > 1) {
    parts.push(`INTERVAL=${String(options.interval)}`);
  }

  if (options.byDay && options.byDay.length > 0) {
    parts.push(`BYDAY=${options.byDay.join(',')}`);
  }

  if (options.byMonthDay && options.byMonthDay.length > 0) {
    parts.push(`BYMONTHDAY=${options.byMonthDay.join(',')}`);
  }

  if (options.byMonth && options.byMonth.length > 0) {
    parts.push(`BYMONTH=${options.byMonth.join(',')}`);
  }

  if (options.count) {
    parts.push(`COUNT=${String(options.count)}`);
  }

  if (options.until) {
    const isoStr = options.until.toISOString().replace(/[-:]/g, '');
    const dateTimePart = isoStr.split('.')[0] ?? isoStr;
    parts.push(`UNTIL=${dateTimePart}Z`);
  }

  return parts.join(';');
}

/**
 * Parse basic RRULE parameters.
 */
export function parseRRuleBasic(rruleString: string): {
  frequency: string | null;
  interval: number;
  byDay: string[];
  byMonthDay: number[];
  count: number | null;
  until: Date | null;
} {
  const params: Record<string, string> = {};
  const parts = rruleString.replace(/^RRULE:/, '').split(';');

  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key && value) {
      params[key] = value;
    }
  }

  return {
    frequency: params['FREQ'] ?? null,
    interval: params['INTERVAL'] ? parseInt(params['INTERVAL'], 10) : 1,
    byDay: params['BYDAY'] ? params['BYDAY'].split(',') : [],
    byMonthDay: params['BYMONTHDAY'] ? params['BYMONTHDAY'].split(',').map(Number) : [],
    count: params['COUNT'] ? parseInt(params['COUNT'], 10) : null,
    until: params['UNTIL'] ? parseRRuleDate(params['UNTIL']) : null,
  };
}

/**
 * Parse an RRULE date string (YYYYMMDD or YYYYMMDDTHHMMSSZ).
 */
function parseRRuleDate(dateStr: string): Date | null {
  try {
    // Handle YYYYMMDDTHHMMSSZ format
    if (dateStr.includes('T')) {
      const year = parseInt(dateStr.slice(0, 4), 10);
      const month = parseInt(dateStr.slice(4, 6), 10) - 1;
      const day = parseInt(dateStr.slice(6, 8), 10);
      const hour = parseInt(dateStr.slice(9, 11), 10);
      const minute = parseInt(dateStr.slice(11, 13), 10);
      const second = parseInt(dateStr.slice(13, 15), 10);
      return new Date(Date.UTC(year, month, day, hour, minute, second));
    }
    // Handle YYYYMMDD format
    const year = parseInt(dateStr.slice(0, 4), 10);
    const month = parseInt(dateStr.slice(4, 6), 10) - 1;
    const day = parseInt(dateStr.slice(6, 8), 10);
    return new Date(year, month, day);
  } catch {
    return null;
  }
}
