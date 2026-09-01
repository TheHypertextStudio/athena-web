/**
 * `@docket/planning` — strict ISO calendar-date arithmetic with no server-timezone dependency.
 *
 * @remarks
 * Recurrence schedules describe civil dates, not instants. Every operation in this module uses UTC
 * only as a stable arithmetic coordinate; no value is interpreted as midnight in the server's
 * timezone. This avoids DST gaps, repeated hours, and `new Date('YYYY-MM-DD')` environment drift.
 */

const DAY_MILLISECONDS = 86_400_000;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The parsed fields of a strict `YYYY-MM-DD` calendar date. */
export interface CalendarDateParts {
  /** Four-digit Gregorian year. */
  readonly year: number;
  /** One-based Gregorian month. */
  readonly month: number;
  /** One-based day of month. */
  readonly day: number;
}

/** Whether `year` is a leap year in the proleptic Gregorian calendar. */
export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** The number of valid days in a Gregorian month. */
export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || year < 0 || year > 9999) {
    throw new RangeError('Calendar year must be an integer from 0000 through 9999');
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError('Calendar month must be an integer from 1 through 12');
  }
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Parse and validate a strict ISO `YYYY-MM-DD` calendar date. */
export function parseCalendarDate(value: string): CalendarDateParts {
  const match = CALENDAR_DATE.exec(value);
  if (!match) throw new RangeError(`Invalid calendar date: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }
  return { year, month, day };
}

/** Format validated Gregorian fields as a strict ISO `YYYY-MM-DD` calendar date. */
export function formatCalendarDate(parts: CalendarDateParts): string {
  const { year, month, day } = parts;
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError('Cannot format an invalid calendar date');
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Convert calendar fields to a UTC coordinate while preserving years 0000 through 0099. */
function coordinate(parts: CalendarDateParts): Date {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return date;
}

/** Convert a strict calendar date to its integer day coordinate. */
function dayCoordinate(value: string): number {
  return Math.floor(coordinate(parseCalendarDate(value)).getTime() / DAY_MILLISECONDS);
}

/** Convert an integer day coordinate back to a strict calendar date. */
function fromDayCoordinate(value: number): string {
  const date = new Date(value * DAY_MILLISECONDS);
  return formatCalendarDate({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

/** Compare two strict calendar dates without interpreting either as a local timestamp. */
export function compareCalendarDates(left: string, right: string): number {
  const leftDay = dayCoordinate(left);
  const rightDay = dayCoordinate(right);
  return leftDay === rightDay ? 0 : leftDay < rightDay ? -1 : 1;
}

/** Add a signed number of civil days to a strict calendar date. */
export function addCalendarDays(value: string, days: number): string {
  if (!Number.isSafeInteger(days))
    throw new RangeError('Calendar-day offset must be a safe integer');
  return fromDayCoordinate(dayCoordinate(value) + days);
}

/** The signed number of civil days from `start` to `end`. */
export function calendarDaysBetween(start: string, end: string): number {
  return dayCoordinate(end) - dayCoordinate(start);
}

/** Zero-based weekday index where Monday is 0 and Sunday is 6. */
export function mondayWeekdayIndex(value: string): number {
  const utcDay = coordinate(parseCalendarDate(value)).getUTCDay();
  return (utcDay + 6) % 7;
}

/** Add a signed number of months, returning the first day of the destination month. */
export function addCalendarMonths(value: string, months: number): CalendarDateParts {
  if (!Number.isSafeInteger(months)) {
    throw new RangeError('Calendar-month offset must be a safe integer');
  }
  const start = parseCalendarDate(value);
  const absoluteMonth = start.year * 12 + (start.month - 1) + months;
  const year = Math.floor(absoluteMonth / 12);
  const month = ((absoluteMonth % 12) + 12) % 12;
  if (year < 0 || year > 9999) throw new RangeError('Calendar-month result is out of range');
  return { year, month: month + 1, day: 1 };
}
