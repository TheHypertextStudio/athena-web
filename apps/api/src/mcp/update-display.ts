/**
 * `@docket/api` — how the `update` report card names a row and shows what moved on it.
 */
import { fieldDiffs, type FieldDiff } from './catalog-rows';

/**
 * Render one value for comparison, so a report card reads without a type switch.
 *
 * @remarks
 * Lossless on purpose — this is what decides whether a field moved. {@link fieldDiffs} shortens it
 * only for display.
 */
function display(value: unknown): string {
  if (value === null || value === undefined) {
    return 'none';
  }
  if (typeof value === 'string') {
    return value;
  }
  // Dates are the only tracked non-primitive, and only their day matters in a diff line.
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * What to call a row in a report line.
 *
 * @remarks
 * Tasks carry `title` and containers carry `name`; the report speaks one word for both, the same
 * way {@link updateSetFields} accepts one word for both.
 *
 * @param row - The row.
 * @param fallback - Used when neither column holds text, so a line never renders blank.
 * @returns the display name.
 */
export function titleOf(row: Record<string, unknown>, fallback: string): string {
  const named = row['title'] ?? row['name'];
  return typeof named === 'string' && named.length > 0 ? named : fallback;
}

/** The fields that actually moved, as `from → to` pairs a person can check. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): FieldDiff[] {
  return fieldDiffs(before, after, (_field, value) => display(value));
}
