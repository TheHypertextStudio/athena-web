/**
 * Time formatting for the Agents (sessions) flagship.
 *
 * @remarks
 * Session rows lead with *when* a run started ("2h ago") and how long it has been *going*
 * (its elapsed duration). Both use the platform `Intl` APIs so phrasing is locale-aware.
 * `relativeTime` mirrors the project-detail stamp; `elapsed` renders a compact wall-clock
 * span ("1h 12m", "44s") between two timestamps for an in-flight or just-settled run.
 */

/** The largest relative-unit thresholds, in seconds, paired with their unit + divisor. */
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
 * relativeTime('2026-06-07T10:00:00Z'); // 'just now' / '2 hr. ago' / 'Jun 1, 2026'
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

/**
 * Format the elapsed span between a start and end (or now) as a compact duration.
 *
 * @remarks
 * Used for a session's "running for…" / "ran for…" stamp. Renders the two most significant
 * units (e.g. `1h 12m`, `3m 04s`, `44s`) so an in-flight run reads at a glance. A missing or
 * future start yields `null` so callers can omit the stamp entirely.
 *
 * @param startIso - The ISO start timestamp, or `null`/`undefined` when the run has not begun.
 * @param endIso - The ISO end timestamp; omit (or pass `null`) for a still-running session.
 * @param now - The reference time used when `endIso` is absent; injectable for tests.
 * @returns the compact duration string, or `null` when no meaningful span exists.
 *
 * @example
 * ```ts
 * elapsed('2026-06-07T10:00:00Z', '2026-06-07T11:12:00Z'); // '1h 12m'
 * ```
 */
export function elapsed(
  startIso: string | null | undefined,
  endIso?: string | null,
  now: Date = new Date(),
): string | null {
  if (!startIso) return null;
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : now.getTime();
  const totalSecs = Math.floor((end - start) / 1000);
  if (!Number.isFinite(totalSecs) || totalSecs < 0) return null;

  const days = Math.floor(totalSecs / 86_400);
  const hours = Math.floor((totalSecs % 86_400) / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const seconds = totalSecs % 60;

  if (days > 0) return `${String(days)}d ${String(hours)}h`;
  if (hours > 0) return `${String(hours)}h ${String(minutes)}m`;
  if (minutes > 0) return `${String(minutes)}m ${String(seconds).padStart(2, '0')}s`;
  return `${String(seconds)}s`;
}
