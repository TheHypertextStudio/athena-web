/**
 * `@docket/api` — translate stored {@link ViewFilter} predicates into SQL over `event`.
 *
 * @remarks
 * The Stream is a firehose, so its attribute filters must run in SQL (not the client-side
 * `applyView` the entity lists use). Fields are **whitelisted** — real columns for the hot
 * path, jsonb `->>'…'` paths for the few entity/actor facets — and an unknown field is a
 * 400, never a silent no-op. The field keys mirror the web stream-catalog + `StreamQuery`
 * quick-filters (`system`/`kind`/`entityKind`). Also exports the `(occurredAt, id)` cursor
 * codec the stream read endpoints page with.
 */
import { event } from '@docket/db';
import type { ViewFilter } from '@docket/db';
import {
  and,
  type AnyColumn,
  eq,
  gt,
  ilike,
  inArray,
  lt,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';

import { ApiError } from '../error';

/** Whitelisted filterable fields → the SQL expression they map to (columns wrapped uniformly). */
const FILTER_FIELDS: Record<string, SQL> = {
  system: sql`${event.sourceSystem}`,
  kind: sql`${event.kind}`,
  entityKind: sql`${event.entityKind}`,
  title: sql`${event.title}`,
  summary: sql`${event.summary}`,
  integrationId: sql`${event.integrationId}`,
  organizationId: sql`${event.organizationId}`,
  occurredAt: sql`${event.occurredAt}`,
  entityExternalId: sql`${event.entity}->>'externalId'`,
  entityTitle: sql`${event.entity}->>'title'`,
  actor: sql`${event.actor}->>'displayName'`,
};

/** Fields whose values are timestamps and must be coerced from ISO strings. */
const DATE_FIELDS = new Set(['occurredAt']);

function rejectField(field: string): never {
  throw new ApiError(400, 'validation_error', `Unknown filter field: ${field}`, {
    filter: [`Unknown field "${field}"`],
  });
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

/**
 * Build the SQL conditions for a set of stored filter predicates (AND-combined by the caller).
 *
 * @param filters - The decoded `ViewFilter[]` from a saved view / the `filter` query param.
 * @returns one SQL condition per predicate.
 * @throws {ApiError} 400 when a predicate names a non-whitelisted field.
 */
export function buildFilterConditions(filters: readonly ViewFilter[]): SQL[] {
  const conds: SQL[] = [];
  for (const f of filters) {
    const col = FILTER_FIELDS[f.field];
    if (!col) rejectField(f.field);
    const isDate = DATE_FIELDS.has(f.field);
    const coerce = (v: unknown): unknown => (isDate ? new Date(String(v)) : v);
    switch (f.op) {
      case 'eq':
        conds.push(eq(col, coerce(f.value)));
        break;
      case 'neq':
        conds.push(ne(col, coerce(f.value)));
        break;
      case 'in':
        conds.push(inArray(col, asArray(f.value).map(coerce)));
        break;
      case 'nin':
        conds.push(notInArray(col, asArray(f.value).map(coerce)));
        break;
      case 'gt':
        conds.push(gt(col, coerce(f.value)));
        break;
      case 'lt':
        conds.push(lt(col, coerce(f.value)));
        break;
      case 'contains':
        conds.push(ilike(col, `%${String(f.value)}%`));
        break;
      default:
        throw new ApiError(400, 'validation_error', `Unknown filter operator: ${String(f.op)}`, {
          filter: [`Unknown operator "${String(f.op)}"`],
        });
    }
  }
  return conds;
}

/** Decode the base64url-encoded `JSON ViewFilter[]` filter param; `[]` on absent/malformed. */
export function decodeFilter(encoded: string | undefined): ViewFilter[] {
  if (!encoded) return [];
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return Array.isArray(parsed) ? (parsed as ViewFilter[]) : [];
  } catch {
    return [];
  }
}

/** A decoded stream cursor: the `(occurredAt, id)` keyset position. */
export interface StreamCursor {
  readonly occurredAt: Date;
  readonly id: string;
}

/** Encode a keyset cursor from the last row's `(occurredAt, id)`. */
export function encodeCursor(occurredAt: Date, id: string): string {
  return Buffer.from(`${occurredAt.toISOString()}|${id}`).toString('base64url');
}

/** Decode a keyset cursor; null when absent or malformed (caller treats as first page). */
export function decodeCursor(cursor: string | undefined): StreamCursor | null {
  if (!cursor) return null;
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!iso || !id) return null;
    const occurredAt = new Date(iso);
    if (Number.isNaN(occurredAt.getTime())) return null;
    return { occurredAt, id };
  } catch {
    return null;
  }
}

/**
 * The keyset WHERE condition for a cursor — rows strictly after it in the sort order.
 *
 * @param cursor - The decoded position.
 * @param order - Sort direction (matches the query's `order`).
 * @param occCol - The `occurred_at` column to compare (event's, or the recipient's denormalized copy).
 * @param idCol - The tiebreaker id column paired with `occCol`.
 */
export function cursorCondition(
  cursor: StreamCursor,
  order: 'asc' | 'desc',
  occCol: AnyColumn = event.occurredAt,
  idCol: AnyColumn = event.id,
): SQL {
  const cmp = order === 'asc' ? gt : lt;
  const condition = or(
    cmp(occCol, cursor.occurredAt),
    and(eq(occCol, cursor.occurredAt), cmp(idCol, cursor.id)),
  );
  /* v8 ignore next -- @preserve defensive: or() of two defined conditions is never undefined */
  if (!condition) throw new Error('cursor condition was empty');
  return condition;
}
