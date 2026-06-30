/**
 * `@docket/api` — the single-row query helper.
 *
 * @remarks
 * Runs a select with `LIMIT 1` and returns its row (or `undefined` when nothing matched),
 * replacing the repeated `const [row] = await db.select()….limit(1)` destructuring pattern.
 * The query is awaited *after* applying the limit, so callers never write `.limit(1)` themselves.
 */

/** A drizzle select builder: awaitable to `TRow[]` and able to apply a `LIMIT`. */
interface LimitableQuery<TRow> extends PromiseLike<TRow[]> {
  limit: (count: number) => PromiseLike<TRow[]>;
}

/**
 * Apply `LIMIT 1` to a select and return its single row, or `undefined` when none matched.
 *
 * @param query - A drizzle select builder (e.g. `db.select().from(t).where(…)`).
 * @returns the first (only) row, or `undefined`.
 */
export async function one<TRow>(query: LimitableQuery<TRow>): Promise<TRow | undefined> {
  const rows = await query.limit(1);
  return rows[0];
}
