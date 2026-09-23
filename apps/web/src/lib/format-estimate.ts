/**
 * Formatting for a task's time estimate.
 *
 * @remarks
 * A task's time estimate (`estimateMinutes`, whole minutes) reads as a clock duration — `0:30`,
 * `1:15` — the same shape as the tracking pill's `0:12:05`, so planned and tracked time line up.
 * Zero is a real estimate (`0:00`), distinct from none. {@link parseEstimate} in
 * `./parse-estimate` is the inverse for typed input.
 */

/** Minutes in one hour, factored out so the breakdown reads clearly. */
const MINUTES_PER_HOUR = 60;

/**
 * Format a task's time estimate as `h:mm`, or `null` when unset.
 *
 * @param estimateMinutes - The estimate in minutes, or null/undefined when unset.
 * @returns `"0:00"`, `"0:45"`, `"1:30"`, `"12:00"`; `null` for an unset, negative, or non-finite
 *   value.
 */
export function formatEstimate(estimateMinutes: number | null | undefined): string | null {
  if (estimateMinutes === null || estimateMinutes === undefined) return null;
  if (!Number.isFinite(estimateMinutes) || estimateMinutes < 0) return null;
  const total = Math.round(estimateMinutes);
  const hours = Math.floor(total / MINUTES_PER_HOUR);
  const minutes = total % MINUTES_PER_HOUR;
  return `${String(hours)}:${String(minutes).padStart(2, '0')}`;
}
