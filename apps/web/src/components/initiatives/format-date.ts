/**
 * Absolute-date formatting for the Initiatives roadmap.
 *
 * @remarks
 * The roadmap reasons about *spans* (a Project's `[startDate, targetDate]`) and discrete
 * milestones (an Initiative's `targetDate`), so a relative "2h ago" stamp would read
 * poorly here — a roadmap wants concrete calendar dates. These helpers format ISO dates
 * with the platform `Intl.DateTimeFormat` (locale-aware) into the short, axis-friendly
 * forms the timeline uses, and parse ISO date strings to epoch millis for layout math.
 */

/**
 * Format an ISO date (or date-time) as a short, locale-aware calendar date.
 *
 * @param iso - The ISO date string, or null/undefined when unscheduled.
 * @returns a short date like `Jun 7, 2026`, or null when no date is set.
 *
 * @example
 * ```ts
 * formatDate('2026-06-07'); // 'Jun 7, 2026'
 * formatDate(null);         // null
 * ```
 */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format an ISO date as a compact month-and-year axis tick (e.g. `Jun '26`).
 *
 * @param ms - Epoch milliseconds for the tick.
 * @returns a short month/year label suitable for a dense time axis.
 */
export function formatAxisTick(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
}

/**
 * Parse an ISO date string to epoch milliseconds.
 *
 * @param iso - The ISO date string, or null/undefined.
 * @returns the epoch millis, or null when the value is absent or unparseable.
 */
export function toMillis(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}
