/**
 * Date-window formatting for the Cycles screens.
 *
 * @remarks
 * A cycle is a time window (`startsAt`..`endsAt`). These helpers render that window for the
 * list/detail headers and compute the window's live progress (how far "today" sits between
 * the two ends) so a banner can show how much runway is left. All use the platform `Intl`
 * APIs so phrasing is locale-aware, and treat the bounds as calendar instants in the
 * caller's local zone (matching how the API stores them).
 */

/** A formatter for a short, year-less day (e.g. "Jun 7"); reused across the screens. */
const SHORT_DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/** A formatter for a short day *with* its year (e.g. "Jun 7, 2026") for cross-year windows. */
const SHORT_DAY_YEAR = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/**
 * Format a cycle's window as a compact range (e.g. "Jun 7 – Jun 21").
 *
 * @remarks
 * The year is shown only when the two ends fall in different calendar years, keeping the
 * common same-year window terse while staying unambiguous across a year boundary.
 *
 * @param startsAt - ISO start instant.
 * @param endsAt - ISO end instant.
 * @returns the formatted window range.
 *
 * @example
 * ```ts
 * formatWindow('2026-06-07T00:00:00Z', '2026-06-21T00:00:00Z'); // 'Jun 7 – Jun 21'
 * ```
 */
export function formatWindow(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const sameYear = start.getFullYear() === end.getFullYear();
  const fmt = sameYear ? SHORT_DAY : SHORT_DAY_YEAR;
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

/** The total whole-day span of a cycle window (inclusive of both ends, minimum 1). */
export function windowDays(startsAt: string, endsAt: string): number {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  const days = Math.round((end - start) / 86_400_000) + 1;
  return Math.max(1, days);
}

/** A cycle window's live position: where "now" sits relative to its bounds. */
export interface WindowProgress {
  /** Whole days from the window start to `now`, clamped to `[0, total]`. */
  readonly elapsedDays: number;
  /** The window's total whole-day span (inclusive). */
  readonly totalDays: number;
  /** Whole days remaining until the window closes (0 once past the end). */
  readonly remainingDays: number;
  /** Fraction of the window elapsed, in `[0, 1]`. */
  readonly fraction: number;
  /** Whether `now` falls before the window opens. */
  readonly notStarted: boolean;
  /** Whether `now` falls after the window closes. */
  readonly ended: boolean;
}

/**
 * Compute where "now" sits within a cycle's window.
 *
 * @remarks
 * Drives the detail banner's "day N of M · K left" runway line and the time-axis marker on
 * the burn-up. `now` is injectable so the calculation is deterministic in tests.
 *
 * @param startsAt - ISO start instant.
 * @param endsAt - ISO end instant.
 * @param now - The reference time (defaults to now).
 * @returns the window's live {@link WindowProgress}.
 */
export function windowProgress(
  startsAt: string,
  endsAt: string,
  now: Date = new Date(),
): WindowProgress {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  const totalDays = windowDays(startsAt, endsAt);
  const span = Math.max(1, end - start);
  const rawFraction = (now.getTime() - start) / span;
  const fraction = Math.min(1, Math.max(0, rawFraction));
  const elapsedDays = Math.min(
    totalDays,
    Math.max(0, Math.round((now.getTime() - start) / 86_400_000)),
  );
  return {
    elapsedDays,
    totalDays,
    remainingDays: Math.max(0, totalDays - elapsedDays),
    fraction,
    notStarted: now.getTime() < start,
    ended: now.getTime() > end,
  };
}
