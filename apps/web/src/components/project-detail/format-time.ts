/**
 * Relative-time formatting for the project-detail activity surfaces.
 *
 * @remarks
 * Comments, updates, and agent activity all read better with a human "2h ago" stamp than a
 * raw ISO date. This uses the platform `Intl.RelativeTimeFormat` so the phrasing is
 * locale-aware, falling back to an absolute date for anything older than a week (where
 * "8 days ago" is less useful than the date itself).
 */

/** The largest relative unit thresholds, in seconds, paired with their unit. */
const THRESHOLDS: readonly [limit: number, unit: Intl.RelativeTimeFormatUnit, secs: number][] = [
  [60, 'second', 1],
  [3600, 'minute', 60],
  [86_400, 'hour', 3600],
  [604_800, 'day', 86_400],
];

/**
 * Format an ISO timestamp as a relative "… ago" stamp, or an absolute date when old.
 *
 * @param iso - The ISO timestamp to format.
 * @param now - The reference time (defaults to now); injectable for deterministic tests.
 * @returns a short relative or absolute time string.
 *
 * @example
 * ```ts
 * relativeTime('2026-06-07T10:00:00Z'); // 'just now' / '2h ago' / 'Jun 1, 2026'
 * ```
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const diffSecs = Math.round((then - now.getTime()) / 1000);
  const abs = Math.abs(diffSecs);

  if (abs < 45) return 'just now';

  for (const [limit, unit, secs] of THRESHOLDS) {
    if (abs < limit) {
      const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });
      return rtf.format(Math.round(diffSecs / secs), unit);
    }
  }

  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
