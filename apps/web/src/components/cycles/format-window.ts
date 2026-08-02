/**
 * Date-window formatting for the Cycles screens.
 *
 * @remarks
 * A cycle is a time window (`startsAt`..`endsAt`). These helpers render that window for the
 * list/overview/detail headers and compute the window's live progress (how far "today" sits
 * between the two ends) so a banner can show how much runway is left.
 *
 * Everything here is anchored to **UTC calendar days**, and the range string is produced by the
 * shared {@link defaultCycleName} in `@docket/types` — the same function the API uses to derive a
 * cycle's `displayName`. Both choices fix real defects:
 *
 * - The window bounds are UTC instants (`2026-07-27T00:00:00.000Z`). Formatting them with a
 *   local-zone formatter rendered "Jul 26" anywhere west of Greenwich while the properties panel,
 *   which slices the ISO string, rendered "Jul 27" — one record showing two start dates on one
 *   screen. Delegating to the shared, UTC-pinned formatter means there is exactly one
 *   implementation and every surface agrees.
 * - A window's `endsAt` is one millisecond before the next window opens, so differencing the two
 *   instants and rounding counted a 7-day cycle as 8 ("Day 6 of 8"). {@link windowDays} now diffs
 *   whole UTC calendar days, which yields 7 for the auto-rolled
 *   `[Mon 00:00:00.000Z, Sun 23:59:59.999Z]` window *and* 7 for a hand-created `[Jul 1, Jul 7]`.
 */
import { defaultCycleName } from '@docket/types';

/** Milliseconds in a whole day. */
const DAY_MS = 86_400_000;

/** The UTC midnight of an instant's calendar day, as epoch milliseconds. */
function utcDayStart(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

/**
 * Format a cycle's window as a compact range (e.g. "Jun 7 – Jun 21").
 *
 * @remarks
 * Delegates to {@link defaultCycleName} so the window a cycle row shows is byte-identical to the
 * `displayName` the API derives for an unnamed cycle — a divergent local formatter here is what
 * made the same cycle read "Jul 26 – Aug 2" in the list and "Jul 27, 2026" in its properties.
 * The year is shown only when the two ends fall in different UTC years.
 *
 * @param startsAt - ISO start instant.
 * @param endsAt - ISO end instant.
 * @returns the formatted window range.
 *
 * @example
 * ```ts
 * formatWindow('2026-07-27T00:00:00.000Z', '2026-08-02T23:59:59.999Z'); // 'Jul 27 – Aug 2'
 * ```
 */
export function formatWindow(startsAt: string, endsAt: string): string {
  return defaultCycleName(startsAt, endsAt);
}

/**
 * The total whole-day span of a cycle window, inclusive of both ends (minimum 1).
 *
 * @remarks
 * Counts **UTC calendar days**, not elapsed milliseconds. An auto-rolled window ends at
 * `23:59:59.999Z` of its last day, so an elapsed-time difference rounds up to an extra day and a
 * weekly cycle reports 8 days. Diffing the two days' UTC midnights and adding 1 for inclusivity
 * gives 7 for that window and 7 for a hand-created `[Jul 1, Jul 7]` one alike.
 *
 * @param startsAt - ISO start instant.
 * @param endsAt - ISO end instant.
 * @returns the inclusive whole-day span, at least 1.
 */
export function windowDays(startsAt: string, endsAt: string): number {
  const start = utcDayStart(new Date(startsAt));
  const end = utcDayStart(new Date(endsAt));
  return Math.max(1, Math.round((end - start) / DAY_MS) + 1);
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
 * Drives the overview/detail "Day N of M · K days left" runway line and the time-axis marker on
 * the burn-up. `elapsedDays` counts whole UTC calendar days from the start day (so the first day
 * of a cycle is day 1 after the `+ 1` a caller applies) and stays clamped to `[0, totalDays]`,
 * which keeps "Day N of M" from ever exceeding M. `now` is injectable so the calculation is
 * deterministic in tests.
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
    Math.max(0, Math.round((utcDayStart(now) - utcDayStart(new Date(startsAt))) / DAY_MS)),
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

/**
 * Phrase a cycle window's live position as one short runway clause.
 *
 * @remarks
 * The single implementation, deliberately: the Cycles list overview and the cycle detail masthead
 * both answer "how much of this cycle is left", and while each owned its own version of this
 * sentence they disagreed — the same cycle read `Day 7 of 7 · last day` on the list and
 * `Day 6 of 7 · 1 day left` on its own detail page. It lives beside {@link windowProgress} because
 * it is window arithmetic phrased for a reader, not a property of either surface.
 *
 * The day number is **1-based** — the first day of a cycle is day 1, not day 0 — so "days left"
 * counts the days still *ahead* of today and the final day says exactly that rather than the
 * self-contradictory "1 day left". Windows that have not opened or have already closed get their
 * own sentence instead of a day count that would not mean anything.
 *
 * @param progress - The window's live {@link WindowProgress}.
 * @returns e.g. `Day 5 of 7 · 2 days left`, `Starts in 3 days`, or `Wrapped · ran 7 days`.
 */
export function windowRunway(progress: WindowProgress): string {
  const total = progress.totalDays;
  if (progress.notStarted) {
    return total === 1 ? 'Starts soon' : `Starts in ${String(progress.remainingDays)} days`;
  }
  if (progress.ended) {
    return `Wrapped · ran ${String(total)} ${total === 1 ? 'day' : 'days'}`;
  }
  const dayNumber = Math.min(total, progress.elapsedDays + 1);
  const daysLeft = total - dayNumber;
  const left =
    daysLeft === 0 ? 'last day' : `${String(daysLeft)} ${daysLeft === 1 ? 'day' : 'days'} left`;
  return `Day ${String(dayNumber)} of ${String(total)} · ${left}`;
}
