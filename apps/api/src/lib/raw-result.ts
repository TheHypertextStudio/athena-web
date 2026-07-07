/**
 * Read rows returned from a Drizzle raw query across supported Postgres drivers.
 *
 * @remarks
 * `postgres-js` raw results are array-like row lists, while PGlite returns an object with a
 * `rows` array. Most API code should use Drizzle's typed builders; this helper is only for raw
 * SQL spots that need to inspect returned rows.
 *
 * @param result - The raw result returned by `db.execute(...)` or transaction `execute(...)`.
 * @returns rows from the raw result, or an empty array when the driver shape is unknown.
 */
export function rawResultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (typeof result !== 'object' || result === null) return [];
  if (!('rows' in result)) return [];
  return Array.isArray(result.rows) ? (result.rows as T[]) : [];
}

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
  return rawResultRows<unknown>(result).length;
}
