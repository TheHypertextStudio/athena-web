/**
 * `@docket/ui` — pure calendar-day arithmetic for the date pickers.
 *
 * @remarks
 * Every date the product stores is a *calendar day* (`YYYY-MM-DD`), not an instant. Treating one
 * as an instant is what produced the two defects this module exists to prevent:
 *
 * 1. **Day drift.** `new Date('2026-08-02')` parses as UTC midnight, which is the *previous* day
 *    west of Greenwich, so a picker built on it silently saves the wrong day for half the planet.
 * 2. **`Invalid Date` on screen.** `new Date(x).toLocaleDateString()` returns the literal string
 *    `"Invalid Date"` for anything it cannot parse, and React renders it verbatim. The author's
 *    requirement is absolute: there is no such thing as an invalid date in this product.
 *
 * So nothing here ever constructs a local-time `Date` from a string. Days are compared and
 * formatted as plain year/month/day triples, arithmetic runs through `Date.UTC` (which has no
 * daylight-saving discontinuities), and every formatter returns `null` rather than a broken
 * string when handed something unparseable. A caller that wants an em dash must ask for one.
 */

/** A calendar day with no time zone, no clock, and no instant. */
export interface CalendarDate {
  /** Full proleptic Gregorian year, e.g. `2026`. */
  readonly year: number;
  /** Month of year, `1`–`12` (NOT the zero-based `Date` month). */
  readonly month: number;
  /** Day of month, `1`–`31`. */
  readonly day: number;
}

/** Strict `YYYY-MM-DD` shape. Anything else is not a calendar day this product accepts. */
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The earliest day any picker offers, mirroring `TASK_DATE_MIN` in `@docket/types`.
 *
 * @remarks
 * Duplicated as a literal rather than imported because `@docket/ui` must not depend on the
 * product's DTO package — the design system is consumed by the admin app too. The pair is held
 * in agreement by `apps/web/tests/pickers/calendar-date.test.ts`, which imports both and asserts
 * they are identical, so a change on either side fails the build instead of drifting.
 */
export const CALENDAR_MIN_DAY = '1970-01-01';

/** The latest day any picker offers, mirroring `TASK_DATE_MAX` in `@docket/types`. */
export const CALENDAR_MAX_DAY = '2200-12-31';

/** Days in a rendered month grid: always six weeks, so the popover never changes height. */
const GRID_WEEKS = 6;

/** Days per week. */
export const DAYS_PER_WEEK = 7;

/**
 * Parse a strict `YYYY-MM-DD` string into a {@link CalendarDate}.
 *
 * @remarks
 * Rejects — by returning `null`, never by throwing — empty strings, ISO *instants*
 * (`2026-08-02T00:00:00.000Z`), impossible days (`2026-02-30`), and out-of-range months. The
 * round-trip check against {@link toIso} is what catches `2026-02-30`: `Date.UTC` happily rolls
 * it forward to March 2nd, and the re-serialized string then differs from the input.
 *
 * @param value - The candidate day string, or `null`/`undefined`.
 * @returns The parsed day, or `null` when the input is not a valid calendar day.
 */
export function parseIsoDate(value: string | null | undefined): CalendarDate | null {
  if (typeof value !== 'string') return null;
  const match = ISO_DAY.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const candidate: CalendarDate = { year, month, day };
  return toIso(candidate) === value ? candidate : null;
}

/** Zero-pad an integer to `width` digits. */
function pad(value: number, width: number): string {
  return String(Math.abs(value)).padStart(width, '0');
}

/**
 * Serialize a {@link CalendarDate} to `YYYY-MM-DD`, normalizing overflow (day 32 → next month).
 *
 * @param date - The day to serialize.
 * @returns The `YYYY-MM-DD` string.
 */
export function toIso(date: CalendarDate): string {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day));
  // `Date.UTC` maps years 0–99 into 1900–1999; the pickers never reach there, but normalize
  // anyway so the function is total rather than surprising.
  if (date.year >= 0 && date.year <= 99) utc.setUTCFullYear(date.year);
  return `${pad(utc.getUTCFullYear(), 4)}-${pad(utc.getUTCMonth() + 1, 2)}-${pad(utc.getUTCDate(), 2)}`;
}

/** True when `value` is a valid strict `YYYY-MM-DD` calendar day. */
export function isIsoDate(value: string | null | undefined): value is string {
  return parseIsoDate(value) !== null;
}

/**
 * Coerce anything date-shaped the API might return into a calendar day.
 *
 * @remarks
 * The API's date columns are `timestamp`, so a field documented as a day can arrive as
 * `2026-08-02T00:00:00.000Z`. Every surface that formats a "date" must survive that without
 * emitting `Invalid Date`, so this takes the leading day of an ISO instant and otherwise
 * returns `null`. It deliberately does NOT convert the instant into the viewer's zone: the
 * value names a calendar day and the day must not shift.
 *
 * @param value - An ISO day, an ISO instant, or anything else.
 * @returns The `YYYY-MM-DD` day, or `null` when none can be read.
 */
export function toCalendarDay(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const head = value.slice(0, 10);
  return isIsoDate(head) ? head : null;
}

/** Lexicographic comparison is chronological for `YYYY-MM-DD`; `-1 | 0 | 1`. */
export function compareIso(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Clamp a day into `[min, max]`.
 *
 * @param value - The day to clamp.
 * @param min - Inclusive lower bound.
 * @param max - Inclusive upper bound.
 * @returns The nearest day inside the bounds.
 */
export function clampIso(value: string, min: string, max: string): string {
  if (compareIso(value, min) < 0) return min;
  if (compareIso(value, max) > 0) return max;
  return value;
}

/** Shift a day by whole days (negative moves back). Returns `YYYY-MM-DD`. */
export function addDays(value: string, delta: number): string {
  const date = parseIsoDate(value);
  if (!date) return value;
  return toIso({ ...date, day: date.day + delta });
}

/**
 * Shift a day by whole months, holding the day-of-month where the target month is long enough.
 *
 * @remarks
 * Jan 31 + 1 month is Feb 28 (or 29), not Mar 3. Naive `day` overflow would roll into the next
 * month and make the grid's "next month" button skip February entirely.
 *
 * @param value - The starting day.
 * @param delta - Months to add; negative moves back.
 * @returns The shifted `YYYY-MM-DD` day.
 */
export function addMonths(value: string, delta: number): string {
  const date = parseIsoDate(value);
  if (!date) return value;
  const zeroBased = date.month - 1 + delta;
  const year = date.year + Math.floor(zeroBased / 12);
  const month = ((zeroBased % 12) + 12) % 12;
  return toIso({ year, month: month + 1, day: Math.min(date.day, daysInMonth(year, month + 1)) });
}

/** Number of days in a given 1-based month. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Day of week for a calendar day, `0` = Sunday … `6` = Saturday. */
export function weekdayOf(value: string): number {
  const date = parseIsoDate(value);
  if (!date) return 0;
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/** The first day of `value`'s month. */
export function startOfMonth(value: string): string {
  const date = parseIsoDate(value);
  if (!date) return value;
  return toIso({ ...date, day: 1 });
}

/** The last day of `value`'s month. */
export function endOfMonth(value: string): string {
  const date = parseIsoDate(value);
  if (!date) return value;
  return toIso({ ...date, day: daysInMonth(date.year, date.month) });
}

/** Today, as the viewer's *local* calendar day (never a UTC instant). */
export function todayIso(now: Date = new Date()): string {
  return toIso({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}

/** One cell of a rendered month grid. */
export interface CalendarCell {
  /** The cell's `YYYY-MM-DD` day. */
  readonly iso: string;
  /** Day of month, for the visible label. */
  readonly day: number;
  /** False for the leading/trailing days borrowed from the adjacent months. */
  readonly inMonth: boolean;
}

/**
 * Build the six-week grid for the month containing `anchor`.
 *
 * @remarks
 * Always six rows regardless of month length, so the popover's height is constant and moving
 * between months never reflows the surrounding page — the same reason MD3 fixes the calendar's
 * container height.
 *
 * @param anchor - Any day inside the month to render.
 * @param weekStartsOn - `0` = Sunday, `1` = Monday.
 * @returns Six weeks of seven cells, in reading order.
 */
export function monthGrid(
  anchor: string,
  weekStartsOn: number,
): readonly (readonly CalendarCell[])[] {
  const first = startOfMonth(anchor);
  const lead = (weekdayOf(first) - weekStartsOn + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  const gridStart = addDays(first, -lead);
  const anchorDate = parseIsoDate(first);
  const weeks: CalendarCell[][] = [];
  for (let week = 0; week < GRID_WEEKS; week += 1) {
    const cells: CalendarCell[] = [];
    for (let index = 0; index < DAYS_PER_WEEK; index += 1) {
      const iso = addDays(gridStart, week * DAYS_PER_WEEK + index);
      const parsed = parseIsoDate(iso);
      cells.push({
        iso,
        day: parsed?.day ?? 1,
        inMonth: parsed?.month === anchorDate?.month && parsed?.year === anchorDate?.year,
      });
    }
    weeks.push(cells);
  }
  return weeks;
}

/**
 * Format a calendar day for display, or return `null` when there is nothing valid to show.
 *
 * @remarks
 * The one formatter every surface must use. It never returns `"Invalid Date"`, `"NaN"`, or a
 * 1970 epoch fallback: an unreadable value yields `null`, and the caller decides what its own
 * empty state says. Formatting runs in UTC against a UTC-constructed instant so the rendered
 * day is exactly the stored day in every zone.
 *
 * @param value - An ISO day or ISO instant.
 * @param options - `Intl.DateTimeFormat` options; defaults to a short "Aug 2, 2026".
 * @param locales - Locale override; defaults to the runtime locale.
 * @returns The formatted day, or `null`.
 */
export function formatCalendarDay(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
  locales?: Intl.LocalesArgument,
): string | null {
  const day = toCalendarDay(value);
  const parsed = parseIsoDate(day);
  if (!day || !parsed) return null;
  const instant = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  return new Intl.DateTimeFormat(locales, { ...options, timeZone: 'UTC' }).format(instant);
}

/** Localized weekday initials in grid order, starting at `weekStartsOn`. */
export function weekdayLabels(
  weekStartsOn: number,
  locales?: Intl.LocalesArgument,
): readonly string[] {
  const formatter = new Intl.DateTimeFormat(locales, { weekday: 'short', timeZone: 'UTC' });
  const labels: string[] = [];
  for (let index = 0; index < DAYS_PER_WEEK; index += 1) {
    // 2024-01-07 is a Sunday, so offsetting from it enumerates weekdays in order.
    labels.push(
      formatter.format(new Date(Date.UTC(2024, 0, 7 + ((weekStartsOn + index) % DAYS_PER_WEEK)))),
    );
  }
  return labels;
}

/** Localized "August 2026" heading for the month containing `anchor`. */
export function monthLabel(anchor: string, locales?: Intl.LocalesArgument): string {
  return (
    formatCalendarDay(anchor, { month: 'long', year: 'numeric' }, locales) ?? anchor.slice(0, 7)
  );
}

/**
 * The locale's first day of the week, `0` = Sunday.
 *
 * @remarks
 * `Intl.Locale.prototype.getWeekInfo` is the standard source but is still absent from some
 * engines (notably older Firefox), so this falls back to Sunday rather than throwing. Using the
 * wrong first day is a cosmetic flaw; crashing the picker is not.
 *
 * @param locales - Locale override; defaults to the runtime locale.
 * @returns `0`–`6`.
 */
export function localeWeekStart(locales?: Intl.LocalesArgument): number {
  try {
    const first: unknown = Array.isArray(locales) ? locales[0] : locales;
    const tag =
      typeof first === 'string' ? first : new Intl.DateTimeFormat().resolvedOptions().locale;
    const resolved: unknown = new Intl.Locale(tag);
    const info = (resolved as { getWeekInfo?: () => { firstDay: number } }).getWeekInfo?.();
    if (!info) return 0;
    // `getWeekInfo` uses ISO numbering (1 = Monday … 7 = Sunday); normalize to 0 = Sunday.
    return info.firstDay % DAYS_PER_WEEK;
  } catch {
    return 0;
  }
}
