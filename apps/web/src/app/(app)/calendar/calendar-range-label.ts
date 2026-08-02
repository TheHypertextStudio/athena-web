/**
 * `(app)/calendar/calendar-range-label` — the calendar's single date atom.
 *
 * @remarks
 * The calendar used to print the same day three times: a toolbar heading (`Aug 2, 2026 – Aug 3,
 * 2026`), a friendly lane header (`Sun, Aug 2`), and an ISO line beneath it (`2026-08-02`). Each
 * date atom now appears exactly once on screen: the **grid** owns weekday and day-of-month, and
 * this module owns the month/year context that the grid deliberately does not repeat per lane.
 *
 * That split is the whole contract, so this function **never** emits a weekday, a day-of-month, or
 * an ISO date — not even as a fallback. Give it a range and it answers "which month(s) am I
 * looking at", nothing more.
 *
 * @see {@link calendarRangeLabel}
 */

/** Matches a bare calendar date (`YYYY-MM-DD`) — the wire shape both axes hand us. */
const BARE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The month/year pair a label is built from, extracted without any timezone round-trip. */
interface MonthPoint {
  /** Full calendar year, e.g. `2026`. */
  readonly year: number;
  /** Zero-based month index, e.g. `7` for August. */
  readonly month: number;
}

/**
 * Read the year and month out of a bare calendar date.
 *
 * @remarks
 * Parsed from the string's own digits rather than through `new Date(value)`, which would read the
 * value as UTC midnight and roll `2026-08-01` back into July for any viewer behind UTC.
 *
 * @param value - A `YYYY-MM-DD` calendar date.
 * @returns the month point, or `null` when the value is not a bare calendar date.
 */
function monthPoint(value: string): MonthPoint | null {
  const match = BARE_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  if (month < 0 || month > 11) return null;
  return { year, month };
}

/**
 * Format one month point in the viewer's locale.
 *
 * @param point - The month point to render.
 * @param style - `'long'` for a standalone month (`August`), `'short'` when two months share a row.
 * @returns the localized month name.
 */
function monthName(point: MonthPoint, style: 'long' | 'short'): string {
  // Day 1 in local time: the formatter only ever reads the month, and a local construction can
  // never slip across a month boundary the way a UTC-parsed instant can.
  return new Intl.DateTimeFormat(undefined, { month: style }).format(
    new Date(point.year, point.month, 1),
  );
}

/**
 * Describe a visible calendar range as month/year context only.
 *
 * @remarks
 * Three shapes, chosen so the label carries exactly the context the grid's lane headers omit and
 * nothing they already show:
 *
 * | Range                       | Label              |
 * | --------------------------- | ------------------ |
 * | Within one month            | `August 2026`      |
 * | Two months, same year       | `Aug – Sep 2026`   |
 * | Across a year boundary      | `Dec 2026 – Jan 2027` |
 *
 * A reversed range (end before start) is normalized, so a caller mid-navigation never renders a
 * backwards label. An unparseable input yields an empty string rather than leaking a raw ISO date
 * into the heading, which is the one output this module exists to prevent.
 *
 * `style: 'short'` abbreviates the single-month case (`Aug 2026`); the two-month shapes already
 * abbreviate, so they are identical in both styles. The toolbar renders the short form where the
 * shell leaves `<main>` too little width for the long one — an abbreviated month still answers
 * "which month am I looking at", whereas a truncated `August 2...` loses the year outright.
 *
 * @param startDate - First visible calendar date, `YYYY-MM-DD`.
 * @param endDate - Last visible calendar date, `YYYY-MM-DD`.
 * @param style - `'long'` (default) spells the standalone month out; `'short'` abbreviates it.
 * @returns the month/year label, or `''` when neither bound is a calendar date.
 *
 * @example
 * ```ts
 * calendarRangeLabel('2026-08-02', '2026-08-03'); // 'August 2026'
 * calendarRangeLabel('2026-08-02', '2026-08-03', 'short'); // 'Aug 2026'
 * calendarRangeLabel('2026-08-30', '2026-09-02'); // 'Aug – Sep 2026'
 * calendarRangeLabel('2026-12-29', '2027-01-04'); // 'Dec 2026 – Jan 2027'
 * ```
 */
export function calendarRangeLabel(
  startDate: string,
  endDate: string,
  style: 'long' | 'short' = 'long',
): string {
  const first = monthPoint(startDate);
  const second = monthPoint(endDate);
  if (!first && !second) return '';

  const a = first ?? second;
  const b = second ?? first;
  /* v8 ignore next -- both bounds are non-null here; the guard above already returned. */
  if (!a || !b) return '';

  const reversed = b.year < a.year || (b.year === a.year && b.month < a.month);
  const start = reversed ? b : a;
  const end = reversed ? a : b;

  if (start.year !== end.year) {
    return `${monthName(start, 'short')} ${String(start.year)} – ${monthName(end, 'short')} ${String(end.year)}`;
  }
  if (start.month !== end.month) {
    return `${monthName(start, 'short')} – ${monthName(end, 'short')} ${String(start.year)}`;
  }
  return `${monthName(start, style)} ${String(start.year)}`;
}
