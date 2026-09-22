/**
 * `@docket/api` — reading recorded change-set values back.
 *
 * @remarks
 * A change set stores rows as JSON, so dates come back as strings. These two helpers are how every
 * reversal compares and restores those values, whichever kind of row it is reversing.
 */

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
    const now = current[key];
    // Dates and enums round-trip through JSON as strings; compare on that footing.
    const normalize = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : v);
    return normalize(now) === normalize(value);
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
