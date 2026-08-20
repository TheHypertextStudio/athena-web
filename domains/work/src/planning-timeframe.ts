import { z } from 'zod';

/** Linear-compatible broad planning-date resolutions. A precise day uses `null`. */
export const DateResolution = z.enum(['month', 'quarter', 'halfYear', 'year']);
/** One Linear-compatible broad planning-date resolution. */
export type DateResolution = z.infer<typeof DateResolution>;

/** A saved planning date with the fiscal basis that defined a broad value. */
export interface PlanningTimeframe {
  /** The canonical date anchor in `YYYY-MM-DD` form. */
  readonly date: string;
  /** The broad resolution, or `null` when the person chose a precise day. */
  readonly resolution: DateResolution | null;
  /** The zero-based fiscal start month for a broad value, or `null` for a precise day. */
  readonly fiscalYearStartMonth: number | null;
}

/** Both inclusive calendar boundaries of a broad planning timeframe. */
export interface TimeframeBounds {
  /** The first day of the period. */
  readonly start: string;
  /** The final day of the period. */
  readonly end: string;
}

/** The boundary stored for one planning-date field. */
export type TimeframeEdge = 'start' | 'target';

interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const SHORT_MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseDate(value: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`Invalid calendar date: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }
  return { year, month, day };
}

function assertFiscalMonth(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 11) {
    throw new RangeError(`Invalid fiscal year start month: ${String(value)}`);
  }
}

function calendarMonth(absoluteMonth: number, day: number): CalendarDate {
  const year = Math.floor(absoluteMonth / 12);
  const month = modulo(absoluteMonth, 12) + 1;
  return { year, month, day };
}

function absoluteMonth(value: Pick<CalendarDate, 'year' | 'month'>): number {
  return value.year * 12 + value.month - 1;
}

function formatDate(value: CalendarDate): string {
  return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(
    value.day,
  ).padStart(2, '0')}`;
}

function fiscalYearStartAbsoluteMonth(
  selected: CalendarDate,
  fiscalYearStartMonth: number,
): number {
  const selectedMonth = selected.month - 1;
  const startYear = selectedMonth >= fiscalYearStartMonth ? selected.year : selected.year - 1;
  return startYear * 12 + fiscalYearStartMonth;
}

function periodLengthMonths(resolution: DateResolution): number {
  switch (resolution) {
    case 'month':
      return 1;
    case 'quarter':
      return 3;
    case 'halfYear':
      return 6;
    case 'year':
      return 12;
  }
}

/**
 * Resolve the inclusive calendar boundaries of the broad period containing a selected day.
 *
 * @param selectedDate - Any day inside the requested period.
 * @param resolution - The period size.
 * @param fiscalYearStartMonth - The zero-based month that starts the fiscal year.
 * @returns The first and final calendar days of the period.
 * @throws {RangeError} When the date or fiscal month is invalid.
 */
export function timeframeBounds(
  selectedDate: string,
  resolution: DateResolution,
  fiscalYearStartMonth: number,
): TimeframeBounds {
  const selected = parseDate(selectedDate);
  assertFiscalMonth(fiscalYearStartMonth);
  const months = periodLengthMonths(resolution);
  const selectedAbsoluteMonth = absoluteMonth(selected);
  const startAbsoluteMonth =
    resolution === 'month'
      ? selectedAbsoluteMonth
      : fiscalYearStartAbsoluteMonth(selected, fiscalYearStartMonth) +
        Math.floor(
          (selectedAbsoluteMonth - fiscalYearStartAbsoluteMonth(selected, fiscalYearStartMonth)) /
            months,
        ) *
          months;
  const endMonth = calendarMonth(startAbsoluteMonth + months - 1, 1);
  return {
    start: formatDate(calendarMonth(startAbsoluteMonth, 1)),
    end: formatDate({ ...endMonth, day: daysInMonth(endMonth.year, endMonth.month) }),
  };
}

/**
 * Resolve the canonical date stored for one broad planning field.
 *
 * @param selectedDate - Any day inside the requested period.
 * @param resolution - The period size.
 * @param fiscalYearStartMonth - The zero-based month that starts the fiscal year.
 * @param edge - `start` stores the first day. `target` stores the final day.
 * @returns The canonical `YYYY-MM-DD` anchor.
 */
export function timeframeAnchor(
  selectedDate: string,
  resolution: DateResolution,
  fiscalYearStartMonth: number,
  edge: TimeframeEdge,
): string {
  const bounds = timeframeBounds(selectedDate, resolution, fiscalYearStartMonth);
  return edge === 'start' ? bounds.start : bounds.end;
}

/**
 * Format a precise or broad planning value for people without exposing its storage anchor.
 *
 * @param date - The saved `YYYY-MM-DD` anchor.
 * @param resolution - The broad resolution, or `null` for a precise day.
 * @param fiscalYearStartMonth - The saved fiscal basis, or `null` for a precise day.
 * @returns The semantic planning label.
 * @throws {RangeError} When the value contains invalid or inconsistent metadata.
 */
export function timeframeLabel(
  date: string,
  resolution: DateResolution | null,
  fiscalYearStartMonth: number | null,
): string {
  const parsed = parseDate(date);
  if (resolution === null) {
    if (fiscalYearStartMonth !== null) {
      throw new RangeError('A precise date cannot carry a fiscal year start month');
    }
    return `${SHORT_MONTH_NAMES[parsed.month - 1]} ${String(parsed.day)}, ${String(parsed.year)}`;
  }
  if (fiscalYearStartMonth === null) {
    throw new RangeError('A broad timeframe requires a fiscal year start month');
  }
  const bounds = timeframeBounds(date, resolution, fiscalYearStartMonth);
  const start = parseDate(bounds.start);
  if (resolution === 'month') {
    return `${MONTH_NAMES[start.month - 1]} ${String(start.year)}`;
  }
  const periodIndex = Math.floor(
    (absoluteMonth(start) - fiscalYearStartAbsoluteMonth(start, fiscalYearStartMonth)) /
      periodLengthMonths(resolution),
  );
  const fiscalYear =
    fiscalYearStartMonth === 0
      ? start.year
      : calendarMonth(fiscalYearStartAbsoluteMonth(start, fiscalYearStartMonth) + 11, 1).year;
  const yearLabel = fiscalYearStartMonth === 0 ? String(fiscalYear) : `FY ${String(fiscalYear)}`;
  if (resolution === 'quarter') return `Q${String(periodIndex + 1)} ${yearLabel}`;
  if (resolution === 'halfYear') return `H${String(periodIndex + 1)} ${yearLabel}`;
  return yearLabel;
}

/**
 * Build a stable scalar used by semantic timeframe filters and grouping.
 *
 * @param date - The saved `YYYY-MM-DD` anchor.
 * @param resolution - The broad resolution, or `null` for a precise day.
 * @param fiscalYearStartMonth - The saved fiscal basis, or `null` for a precise day.
 * @returns A stable key that distinguishes precise days and fiscal definitions.
 */
export function timeframeKey(
  date: string,
  resolution: DateResolution | null,
  fiscalYearStartMonth: number | null,
): string {
  parseDate(date);
  if (resolution === null) {
    if (fiscalYearStartMonth !== null) {
      throw new RangeError('A precise date cannot carry a fiscal year start month');
    }
    return `${date}|day`;
  }
  if (fiscalYearStartMonth === null) {
    throw new RangeError('A broad timeframe requires a fiscal year start month');
  }
  assertFiscalMonth(fiscalYearStartMonth);
  return `${date}|${resolution}|${String(fiscalYearStartMonth)}`;
}

/**
 * Test whether a saved planning value uses the canonical anchor for its field edge.
 *
 * @param value - The saved planning value.
 * @param edge - The field edge being validated.
 * @returns `true` when the metadata pair and anchor agree.
 */
export function isCanonicalTimeframeAnchor(value: PlanningTimeframe, edge: TimeframeEdge): boolean {
  try {
    parseDate(value.date);
    if (value.resolution === null) return value.fiscalYearStartMonth === null;
    if (value.fiscalYearStartMonth === null) return false;
    return (
      timeframeAnchor(value.date, value.resolution, value.fiscalYearStartMonth, edge) === value.date
    );
  } catch {
    return false;
  }
}
