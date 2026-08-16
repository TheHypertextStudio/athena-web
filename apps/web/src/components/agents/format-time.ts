/**
 * Time formatting for the Agents (sessions) flagship.
 *
 * @remarks
 * Session rows lead with *when* a run started ("2h ago") and how long it has been *going* (its
 * elapsed duration). The first is `relativeTime` from `@docket/ui`, re-exported here so the
 * surface's own imports stay in one place; `elapsed` is this surface's alone and renders a
 * compact wall-clock span ("1h 12m", "44s") between two timestamps.
 */

export { relativeTime } from '@docket/ui';

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
