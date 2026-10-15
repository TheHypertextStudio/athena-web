/**
 * `@docket/api` — reading recorded change-set values back.
 *
 * @remarks
 * A change set stores rows as JSON, so dates come back as strings. These two helpers are how every
 * reversal compares and restores those values, whichever kind of row it is reversing.
 */

import { isDeepStrictEqual } from 'node:util';
import { comparableTrackedValue } from './change-set-fields';

/**
 * Whether a row still looks the way this change set left it.
 *
 * @remarks
 * Compares only the fields the change actually wrote. A change set that set `priority` should not
 * refuse to undo because someone edited the title afterwards — the narrow comparison is what makes
 * undo useful on a live workspace rather than only on an untouched one.
 *
 * @param current - The row as it is now.
 * @param after - The row as this change set left it.
 * @returns true when every field this change wrote is unchanged.
 */
export function unchangedSince(
  current: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean {
  return Object.entries(after).every(([key, value]) => {
    return isDeepStrictEqual(
      comparableTrackedValue(key, current[key]),
      comparableTrackedValue(key, value),
    );
  });
}

/**
 * Parse a JSON round-tripped nullable date from a recorded row.
 *
 * @param value - The recorded value.
 * @returns the date, or null when none was recorded.
 * @throws Error when the recorded value is not a date.
 */
export function restoredDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value !== 'string') throw new Error('Recorded task timestamp is invalid');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Recorded task timestamp is invalid');
  return date;
}

/** Decode only known tracked date columns; keep JSON ownership values intact for existing undo. */
export function restoredWorkSnapshot(
  snapshot: Record<string, unknown>,
  current: Record<string, unknown> = {},
): Record<string, unknown> {
  const patch = { ...snapshot };
  for (const field of [
    'startDate',
    'dueDate',
    'targetDate',
    'completedAt',
    'canceledAt',
    'archivedAt',
    'workTypeAssignedAt',
  ])
    if (field in patch) patch[field] = restoredDate(patch[field]);
  if ('blueprintState' in patch)
    patch['blueprintState'] = restoredBlueprintState(
      patch['blueprintState'],
      current['blueprintState'],
    );
  return patch;
}
function restoredBlueprintState(before: unknown, current: unknown): unknown {
  if (
    isDeepStrictEqual(
      comparableTrackedValue('blueprintState', before),
      comparableTrackedValue('blueprintState', current),
    )
  )
    return current;
  if (!before || typeof before !== 'object' || Array.isArray(before)) return before;
  const prior = before as Record<string, unknown>;
  const next =
    current && typeof current === 'object' && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  return {
    ...prior,
    revision: Math.max(Number(prior['revision']), Number(next['revision'] ?? 0)) + 1,
    lastApplicationChangeSetId: null,
  };
}
