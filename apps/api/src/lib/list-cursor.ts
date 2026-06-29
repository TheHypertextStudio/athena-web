/**
 * `@docket/api` — universal keyset (seek) cursor pagination over a `(timestamp, id)` ordering.
 *
 * @remarks
 * The list endpoints order newest-first by a timestamp column with the row id as a deterministic
 * tiebreak (`ORDER BY ts DESC, id DESC`). Keyset pagination then walks that order with a stable
 * `WHERE (ts, id) < (cursorTs, cursorId)` predicate — correct under inserts/deletes, unlike
 * offset paging. The cursor is the opaque base64url encoding of the last returned row's `(ts, id)`.
 *
 * Two entry points cover the common path: {@link seekAfter} builds the WHERE predicate from a raw
 * cursor token (compose it straight into `and(...)`), and {@link pageResult} slices an
 * over-fetched row set into a page + its next cursor. This is intentionally generic (any
 * `(timestamp column, id column)` pair) so every paginated list — cycles, programs, initiatives,
 * tasks, projects — shares one mechanism rather than re-deriving the seek predicate per endpoint.
 */
import { type AnyColumn, type SQL, and, eq, lt, or } from 'drizzle-orm';

/** A decoded keyset cursor: the last seen row's sort timestamp + id. */
interface ListCursor {
  readonly ts: string;
  readonly id: string;
}

/** Encode a `(timestamp, id)` position into an opaque cursor token. */
function encodeListCursor(ts: Date, id: string): string {
  return Buffer.from(`${ts.toISOString()}|${id}`, 'utf8').toString('base64url');
}

/**
 * Decode a cursor token back into its `(ts, id)` position, or `null` for an absent/malformed token
 * (treated as "first page" rather than an error, so a stale cursor degrades to the start, not a 400).
 */
function decodeListCursor(cursor: string | undefined): ListCursor | null {
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
 * The WHERE predicate selecting rows strictly after `cursor` in `(tsCol DESC, idCol DESC)` order,
 * or `undefined` when there is no (or a malformed) cursor — i.e. the first page.
 *
 * @remarks
 * Returning `undefined` for "no cursor" lets callers drop it straight into `and(...)`, which
 * ignores undefined operands — so the per-route decode-and-conditionally-push dance collapses to
 * `where(and(eq(org), seekAfter(tsCol, idCol, cursor)))`.
 *
 * @param tsCol - The timestamp column the list orders by.
 * @param idCol - The id column used as the deterministic tiebreak.
 * @param cursor - The raw cursor token from the request (`undefined` on the first page).
 */
export function seekAfter(
  tsCol: AnyColumn,
  idCol: AnyColumn,
  cursor: string | undefined,
): SQL | undefined {
  const decoded = decodeListCursor(cursor);
  if (!decoded) return undefined;
  const ts = new Date(decoded.ts);
  // `(ts, id) < (cursorTs, cursorId)`, lexicographically — composed from Drizzle's typed operators.
  // `or(...)` is `SQL | undefined`, which is exactly this function's return type, so it flows
  // through with neither a raw `sql` template nor a non-null assertion.
  return or(lt(tsCol, ts), and(eq(tsCol, ts), lt(idCol, decoded.id)));
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
): { items: readonly T[]; nextCursor?: string } {
  if (limit === undefined) return { items: rows };
  const hasMore = rows.length > limit;
  const items: readonly T[] = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  if (hasMore && last) return { items, nextCursor: encodeListCursor(tsOf(last), last.id) };
  return { items };
}
