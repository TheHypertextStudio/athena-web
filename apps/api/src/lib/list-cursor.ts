/**
 * `@docket/api` — universal keyset (seek) cursor pagination over a `(timestamp, id)` ordering.
 *
 * @remarks
 * The list endpoints order newest-first by a timestamp column with the row id as a deterministic
 * tiebreak (`ORDER BY ts DESC, id DESC`). Keyset pagination then walks that order with a stable
 * `WHERE (ts, id) < (cursorTs, cursorId)` predicate — correct under inserts/deletes, unlike
 * offset paging. The cursor is the opaque base64url encoding of the last returned row's `(ts, id)`.
 *
 * This is intentionally generic (any `(timestamp column, id column)` pair) so every paginated list
 * — cycles, programs, initiatives today; tasks/triage once their routes settle — shares one
 * mechanism rather than re-deriving the seek predicate per endpoint.
 */
import { type AnyColumn, type SQL, sql } from 'drizzle-orm';

/** A decoded keyset cursor: the last seen row's sort timestamp + id. */
export interface ListCursor {
  /** ISO timestamp of the last row on the previous page. */
  readonly ts: string;
  /** Id of the last row on the previous page (the tiebreak). */
  readonly id: string;
}

/** Encode a `(timestamp, id)` position into an opaque cursor token. */
export function encodeListCursor(ts: Date, id: string): string {
  return Buffer.from(`${ts.toISOString()}|${id}`, 'utf8').toString('base64url');
}

/**
 * Decode a cursor token back into its `(ts, id)` position.
 *
 * @returns the decoded cursor, or `null` for an absent or malformed token (treated as "first page"
 *   rather than an error, so a stale/garbled cursor degrades to the start instead of a 400).
 */
export function decodeListCursor(cursor: string | undefined): ListCursor | null {
  if (!cursor) return null;
  try {
    const [ts, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!ts || !id || Number.isNaN(Date.parse(ts))) return null;
    return { ts, id };
  } catch {
    return null;
  }
}

/**
 * The seek predicate selecting rows strictly after `cursor` in `(tsCol DESC, idCol DESC)` order.
 *
 * @param tsCol - The timestamp column the list orders by.
 * @param idCol - The id column used as the deterministic tiebreak.
 * @param cursor - The decoded position to seek past.
 */
export function afterCursor(tsCol: AnyColumn, idCol: AnyColumn, cursor: ListCursor): SQL {
  const ts = new Date(cursor.ts);
  // `(ts, id) < (cursorTs, cursorId)` expressed as a lexicographic comparison. Built with a `sql`
  // template (rather than `or(and(...))`, which is typed `SQL | undefined`) so the result is a
  // definite `SQL` with no non-null assertion.
  return sql`(${tsCol} < ${ts} or (${tsCol} = ${ts} and ${idCol} < ${cursor.id}))`;
}

/**
 * Slice an over-fetched row set into a page + its `nextCursor`.
 *
 * @remarks
 * The caller fetches `limit + 1` rows; the extra row signals there's a next page. When `limit` is
 * `undefined` the endpoint is in legacy unbounded mode — every row is returned with no cursor.
 *
 * @param rows - The fetched rows (over-fetched by one when `limit` is set).
 * @param limit - The requested page size, or `undefined` for "return everything".
 * @param tsOf - Reads the sort timestamp from a row (to encode the next cursor).
 * @returns the page's rows and, when more remain, the cursor to fetch them.
 */
export function pageResult<T extends { id: string }>(
  rows: readonly T[],
  limit: number | undefined,
  tsOf: (row: T) => Date,
): { items: T[]; nextCursor?: string } {
  if (limit === undefined) return { items: [...rows] };
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : [...rows];
  const last = items[items.length - 1];
  if (hasMore && last) return { items, nextCursor: encodeListCursor(tsOf(last), last.id) };
  return { items };
}
