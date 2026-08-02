/**
 * `@docket/api` — timezone-aware local-time arithmetic for the weekly planner.
 *
 * @remarks
 * A week is a *local* concept: "Tuesday 9:00–11:00" is a wall-clock fact in the Hub's timezone,
 * and turning it into an instant is where schedulers usually break. Two failure modes matter
 * here and both are handled below:
 *
 * 1. **DST transitions.** A naive `Date.UTC(...) - fixedOffset` places a Sunday-morning block an
 *    hour off on the two weekends a year the offset changes. {@link instantAt} resolves the
 *    offset *at the candidate instant* and then re-resolves once, which converges for every real
 *    zone (offsets change by at most a couple of hours, never repeatedly within one day).
 * 2. **Week boundaries.** The planner's week runs Monday→Sunday in local time, which is not
 *    derivable from UTC day arithmetic near midnight.
 *
 * Everything here is pure and has no database or clock dependency beyond the `Date` passed in,
 * which is what lets the planner be tested at fixed instants.
 */

/** The wall-clock parts of an instant in a timezone. */
export interface ZonedParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

const PARTS_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/** One cached `Intl.DateTimeFormat` per timezone — construction loads locale data and is slow. */
function partsFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = PARTS_FORMATTERS.get(timezone);
  if (cached) return cached;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  PARTS_FORMATTERS.set(timezone, fmt);
  return fmt;
}

/**
 * The wall-clock parts of an instant in a timezone.
 *
 * @param instant - The instant to describe.
 * @param timezone - IANA timezone id.
 * @returns the local year/month/day/hour/minute.
 */
export function zonedParts(instant: Date, timezone: string): ZonedParts {
  const parts = partsFormatter(timezone).formatToParts(instant);
  const pick = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
  };
}

/** Zero-pad to two digits. */
function pad2(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n);
}

/**
 * The local calendar date (`YYYY-MM-DD`) an instant falls on.
 *
 * @param instant - The instant.
 * @param timezone - IANA timezone id.
 * @returns the local ISO date string.
 */
export function localDateString(instant: Date, timezone: string): string {
  const p = zonedParts(instant, timezone);
  return `${String(p.year)}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** The minute-of-day (0–1439) an instant falls on locally. */
export function localMinuteOfDay(instant: Date, timezone: string): number {
  const p = zonedParts(instant, timezone);
  return p.hour * 60 + p.minute;
}

/** The timezone's UTC offset in ms at `instant`: wall-clock-read-as-UTC minus the instant. */
function offsetMsAt(instant: Date, timezone: string): number {
  const p = zonedParts(instant, timezone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - instant.getTime();
}

/** Split a `YYYY-MM-DD` into numeric parts. */
function splitDate(date: string): { year: number; month: number; day: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { year: y ?? 1970, month: m ?? 1, day: d ?? 1 };
}

/**
 * The instant at `minuteOfDay` on a local `date` in `timezone`.
 *
 * @remarks
 * Two-pass offset resolution: guess with the offset that applies to the naive UTC reading, then
 * re-resolve with the offset that actually applies at the resulting instant. This is exact
 * except inside a skipped hour (a spring-forward gap has no such wall-clock time at all), where
 * it lands on the instant immediately after the gap — the only defensible answer.
 *
 * @param date - Local `YYYY-MM-DD`.
 * @param minuteOfDay - Minutes from local midnight; may exceed 1440 to mean "into the next day".
 * @param timezone - IANA timezone id.
 * @returns the corresponding instant.
 */
export function instantAt(date: string, minuteOfDay: number, timezone: string): Date {
  const { year, month, day } = splitDate(date);
  const naiveUtc = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  const firstGuess = new Date(naiveUtc - offsetMsAt(new Date(naiveUtc), timezone));
  return new Date(naiveUtc - offsetMsAt(firstGuess, timezone));
}

/**
 * Shift a local date string by whole days.
 *
 * @param date - Local `YYYY-MM-DD`.
 * @param days - Days to add; may be negative.
 * @returns the shifted local date string.
 */
export function addDays(date: string, days: number): string {
  const { year, month, day } = splitDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${String(shifted.getUTCFullYear())}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/**
 * The day of week for a local date string.
 *
 * @param date - Local `YYYY-MM-DD`.
 * @returns 0 for Sunday through 6 for Saturday.
 */
export function weekdayOf(date: string): number {
  const { year, month, day } = splitDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * The Monday that begins the local week containing `date`.
 *
 * @remarks
 * Monday-first because a plan for "this week" that starts on Sunday splits the working week in
 * two, and every commitment in this product is expressed per working week.
 *
 * @param date - Any local `YYYY-MM-DD` in the week.
 * @returns the local date of that week's Monday.
 */
export function weekStartOf(date: string): string {
  const weekday = weekdayOf(date);
  // Sunday (0) belongs to the week that began six days earlier, not the one starting tomorrow.
  const back = weekday === 0 ? 6 : weekday - 1;
  return addDays(date, -back);
}

/**
 * The seven local dates of the week beginning at `weekStartDate`.
 *
 * @param weekStartDate - The local Monday.
 * @returns seven `YYYY-MM-DD` strings, Monday through Sunday.
 */
export function weekDates(weekStartDate: string): readonly string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStartDate, i));
}

/** Whole minutes between two instants, rounded toward zero. */
export function minutesBetween(from: Date, to: Date): number {
  return Math.trunc((to.getTime() - from.getTime()) / 60_000);
}

/**
 * Format an instant as a local `HH:MM` clock reading.
 *
 * @param instant - The instant.
 * @param timezone - IANA timezone id.
 * @returns a 24-hour `HH:MM` string.
 */
export function localClock(instant: Date, timezone: string): string {
  const p = zonedParts(instant, timezone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}
