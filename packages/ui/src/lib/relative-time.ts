/**
 * `@docket/ui` — how long ago something happened, in words.
 *
 * @remarks
 * A human "2h ago" reads better than a raw ISO date. Uses the platform `Intl.RelativeTimeFormat`
 * for locale-aware phrasing, falling back to an absolute date past a week — at which point "37
 * days ago" has stopped being easier to read than the date itself.
 *
 * This lived as four byte-identical copies under `apps/web/src/components/{settings,
 * project-detail,agents,programs}/format-time.ts`. Four surfaces agreeing on a phrasing by
 * coincidence is four chances to disagree later, and the disagreement would show as the same
 * timestamp reading differently on two screens. It sits beside {@link RelativeTime}, which is the
 * component that keeps the absolute instant reachable underneath this phrasing.
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
