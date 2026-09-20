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
import { type AnyColumn, type SQL, and, eq, gt, lt, or } from 'drizzle-orm';

import { ValidationError } from '../error';

/** A decoded keyset cursor: the last seen row's sort timestamp + id. */
interface ListCursor {
  readonly ts: string;
  readonly id: string;
}

const ID_CURSOR_PREFIX = 'id1:';
const TUPLE_CURSOR_PREFIX = 'tuple1:';

/** Encode a stable row id for lists whose documented canonical order is id-only. */
export function encodeIdCursor(id: string): string {
  return `${ID_CURSOR_PREFIX}${Buffer.from(id, 'utf8').toString('base64url')}`;
}

/** Decode an opaque stable-key cursor, returning `null` only when the header is absent. */
export function decodeIdCursor(cursor: string | undefined): string | null {
  if (cursor === undefined) return null;
  if (!cursor.startsWith(ID_CURSOR_PREFIX)) throw invalidCursor();
  try {
    const id = Buffer.from(cursor.slice(ID_CURSOR_PREFIX.length), 'base64url').toString('utf8');
    if (id.length === 0) throw invalidCursor();
    return id;
  } catch {
    throw invalidCursor();
  }
}

/** Decode an opaque composite-key cursor for a route that validates the tuple's field types. */
export function decodeTupleCursor(cursor: string | undefined): readonly unknown[] | null {
  if (cursor === undefined) return null;
  if (!cursor.startsWith(TUPLE_CURSOR_PREFIX)) throw invalidCursor();
  try {
    const decoded = Buffer.from(cursor.slice(TUPLE_CURSOR_PREFIX.length), 'base64url').toString(
      'utf8',
    );
    const value = JSON.parse(decoded) as unknown;
    if (!Array.isArray(value) || value.length === 0) throw invalidCursor();
    return value.map((item: unknown): unknown => item);
  } catch {
    throw invalidCursor();
  }
}

/** Encode a validated composite ordering key as an opaque cursor. */
export function encodeTupleCursor(tuple: readonly unknown[]): string {
  return `${TUPLE_CURSOR_PREFIX}${Buffer.from(JSON.stringify(tuple), 'utf8').toString('base64url')}`;
}

/** Build the public field-validation error for a malformed opaque cursor. */
function invalidCursor(): ValidationError {
  return new ValidationError([{ path: ['cursor'], message: 'The cursor is invalid or expired.' }]);
}

/**
 * Encode a `(timestamp, id)` position into an opaque cursor token.
 *
 * @remarks
 * Exported for paginators that advance the keyset themselves rather than through
 * {@link pageResult} — browse search refills a page several times before returning it, so it needs
 * to build an intermediate position from a row the caller never sees.
 *
 * @param ts - The sort timestamp of the row to resume after.
 * @param id - That row's id, the deterministic tiebreak.
 */
export function encodeListCursor(ts: Date, id: string): string {
  return Buffer.from(`${ts.toISOString()}|${id}`, 'utf8').toString('base64url');
}

/**
 * Decode a cursor token back into its `(ts, id)` position, returning `null` only when absent.
 * Malformed values fail validation so a client can never mistake a restarted first page for a
 * valid continuation.
 */
function decodeListCursor(cursor: string | undefined): ListCursor | null {
  if (!cursor) return null;
  try {
    const [ts, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!ts || !id || Number.isNaN(Date.parse(ts))) throw invalidCursor();
    return { ts, id };
  } catch {
    throw invalidCursor();
  }
}

/**
 * The WHERE predicate selecting rows strictly after `cursor` in `(tsCol DESC, idCol DESC)` order,
 * or `undefined` when there is no cursor — i.e. the first page.
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
  order: 'asc' | 'desc' = 'desc',
): SQL | undefined {
  const decoded = decodeListCursor(cursor);
  if (!decoded) return undefined;
  const ts = new Date(decoded.ts);
  // `(ts, id) < (cursorTs, cursorId)`, lexicographically — composed from Drizzle's typed operators.
  // `or(...)` is `SQL | undefined`, which is exactly this function's return type, so it flows
  // through with neither a raw `sql` template nor a non-null assertion.
  return order === 'asc'
    ? or(gt(tsCol, ts), and(eq(tsCol, ts), gt(idCol, decoded.id)))
    : or(lt(tsCol, ts), and(eq(tsCol, ts), lt(idCol, decoded.id)));
}

/**
 * Build the keyset predicate for a stable id-only ordering.
 *
 * @param idCol - The unique id column used as the complete ordering key.
 * @param cursor - The opaque id cursor from the preceding page.
 * @param order - The route's documented id ordering.
 * @returns A strict seek predicate, or `undefined` for the first page.
 */
export function seekAfterId(
  idCol: AnyColumn,
  cursor: string | undefined,
  order: 'asc' | 'desc',
): SQL | undefined {
  const id = decodeIdCursor(cursor);
  if (!id) return undefined;
  return order === 'asc' ? gt(idCol, id) : lt(idCol, id);
}

/**
 * Slice an over-fetched row set into a page + its `nextCursor`.
 *
 * @remarks
 * The caller fetches `limit + 1` rows; the extra row signals there's a next page.
 *
 * @param rows - The fetched rows (over-fetched by one when `limit` is set).
 * @param limit - The validated requested page size.
 * @param tsOf - Reads the sort timestamp from a row (to encode the next cursor).
 * @returns the page's rows and, when more remain, the cursor to fetch them.
 */
export function pageResult<T extends { id: string }>(
  rows: readonly T[],
  limit: number,
  tsOf: (row: T) => Date,
): { items: T[]; nextCursor?: string } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : [...rows];
  const last = items[items.length - 1];
  if (hasMore && last) return { items, nextCursor: encodeListCursor(tsOf(last), last.id) };
  return { items };
}

/** Slice an over-fetched timestamp-ordered result whose wire id uses a route-specific field. */
export function pageResultByTimestamp<T>(
  rows: readonly T[],
  limit: number,
  tsOf: (row: T) => Date,
  idOf: (row: T) => string,
): { items: T[]; nextCursor?: string } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : [...rows];
  const last = items[items.length - 1];
  return hasMore && last
    ? { items, nextCursor: encodeListCursor(tsOf(last), idOf(last)) }
    : { items };
}

/** Slice an over-fetched id-ordered result and encode its final returned row as the next cursor. */
export function pageResultById<T extends { id: string }>(
  rows: readonly T[],
  limit: number,
): { items: T[]; nextCursor?: string } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : [...rows];
  const last = items[items.length - 1];
  if (hasMore && last) return { items, nextCursor: encodeIdCursor(last.id) };
  return { items };
}

/** Slice an over-fetched stable-key result and encode its final returned ordering key. */
export function pageResultByKey<T>(
  rows: readonly T[],
  limit: number,
  keyOf: (row: T) => string,
): { items: T[]; nextCursor?: string } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : [...rows];
  const last = items[items.length - 1];
  return hasMore && last ? { items, nextCursor: encodeIdCursor(keyOf(last)) } : { items };
}

/** Slice an over-fetched composite-key result and encode its final returned tuple. */
export function pageResultByTuple<T>(
  rows: readonly T[],
  limit: number,
  tupleOf: (row: T) => readonly unknown[],
): { items: T[]; nextCursor?: string } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : [...rows];
  const last = items[items.length - 1];
  return hasMore && last ? { items, nextCursor: encodeTupleCursor(tupleOf(last)) } : { items };
}
