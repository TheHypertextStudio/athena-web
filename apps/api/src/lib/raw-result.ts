/**
 * Count rows returned from a Drizzle raw query across supported Postgres drivers.
 *
 * @remarks
 * `postgres-js` raw results are array-like row lists, while PGlite returns an object with a
 * `rows` array. Most API code should use Drizzle's typed builders; this helper is only for raw
 * SQL spots that need to know whether any row came back.
 *
 * @param result - The raw result returned by `db.execute(...)` or transaction `execute(...)`.
 * @returns the number of rows in the raw result.
 */
export function rawResultRowCount(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  if (typeof result !== 'object' || result === null) return 0;
  if (!('rows' in result)) return 0;
  return Array.isArray(result.rows) ? result.rows.length : 0;
}
