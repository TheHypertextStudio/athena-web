/**
 * Human-readable formatting for a task's time estimate.
 *
 * @remarks
 * A {@link import('@docket/types').TaskOut | TaskOut} carries its estimate as
 * `estimateMinutes` — an integer count of minutes (Phase 1 backend). The aligned task
 * table surfaces it as a compact, tabular duration ("1h 30m", "45m", "2h") so estimates
 * line up and read at a glance in the table's end-aligned estimate column. A `null`,
 * `undefined`, or non-positive value has no estimate to show and returns `null` so the
 * caller can render a neutral placeholder.
 */

/** Minutes in one hour, factored out so the breakdown reads clearly. */
const MINUTES_PER_HOUR = 60;

/**
 * Format a task's `estimateMinutes` as a compact `Hh Mm` duration, or `null` when unset.
 *
 * @remarks
 * Renders only the non-zero parts: a whole-hour estimate is `"2h"`, a sub-hour estimate is
 * `"45m"`, and a mixed estimate is `"1h 30m"`. A `null`/`undefined` estimate, or a value that
 * is not a positive finite number, returns `null` (there is no duration to show).
 *
 * @param estimateMinutes - The task's estimate in whole minutes, or null/undefined when unset.
 * @returns the formatted duration, or `null` when there is no estimate to render.
 *
 * @example
 * ```ts
 * formatEstimate(90);   // '1h 30m'
 * formatEstimate(45);   // '45m'
 * formatEstimate(120);  // '2h'
 * formatEstimate(null); // null
 * ```
 */
export function formatEstimate(estimateMinutes: number | null | undefined): string | null {
  if (estimateMinutes === null || estimateMinutes === undefined) return null;
  if (!Number.isFinite(estimateMinutes) || estimateMinutes <= 0) return null;
  const total = Math.round(estimateMinutes);
  const hours = Math.floor(total / MINUTES_PER_HOUR);
  const minutes = total % MINUTES_PER_HOUR;
  if (hours === 0) return `${String(minutes)}m`;
  if (minutes === 0) return `${String(hours)}h`;
  return `${String(hours)}h ${String(minutes)}m`;
}
