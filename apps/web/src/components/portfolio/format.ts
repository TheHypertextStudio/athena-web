/**
 * Date + status formatting for the Hub Portfolio timeline.
 *
 * @remarks
 * The portfolio reasons about Project *spans* (`[startDate, targetDate]`) and discrete
 * Milestone checkpoints, so concrete calendar dates read far better than relative stamps.
 * These helpers format ISO dates to short, axis-friendly labels (locale-aware via `Intl`),
 * parse ISO dates to epoch millis for the layout math, and map the free lifecycle-status
 * strings the Hub DTOs carry onto display labels.
 */

/** Project/Program lifecycle status → display label (the Hub carries free strings). */
const STATUS_LABEL: Record<string, string> = {
  planned: 'Planned',
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
  completed: 'Completed',
  canceled: 'Canceled',
};

/** Resolve a lifecycle-status string to its display label, falling back to the raw value. */
export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

/**
 * Parse an ISO date (or date-time) string to epoch milliseconds.
 *
 * @param iso - The ISO date string, or null/undefined when unscheduled.
 * @returns the epoch millis, or null when absent or unparseable.
 */
export function toMillis(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Format an ISO date as a short, locale-aware calendar date.
 *
 * @param iso - The ISO date string, or null/undefined when unscheduled.
 * @returns a short date like `Jun 7, 2026`, or null when no date is set.
 */
export function formatDate(iso: string | null | undefined): string | null {
  const ms = toMillis(iso);
  if (ms === null) return null;
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Build the human span copy for a bar: `start – target`, a single endpoint, or `Unscheduled`.
 *
 * @param startDate - The bar's ISO start date.
 * @param targetDate - The bar's ISO target date.
 * @returns the span copy used in tooltips + `aria-label`s.
 */
export function spanCopy(
  startDate: string | null | undefined,
  targetDate: string | null | undefined,
): string {
  const start = formatDate(startDate);
  const target = formatDate(targetDate);
  if (start && target) return `${start} – ${target}`;
  return start ?? target ?? 'Unscheduled';
}
