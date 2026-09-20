/**
 * `domain packages` — cursor pagination primitives.
 */
import { z } from 'zod';

/** Query params for any list endpoint (cursor + bounded limit + order). */
export const ListQuery = z
  .object({
    cursor: z
      .string()
      .optional()
      .describe(
        "Opaque keyset cursor copied verbatim from a prior page's `nextCursor`; omit for the first page. Encodes the position to continue after — never construct it by hand.",
      ),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe('Maximum items to return on this page, 1..100 (default 50).'),
    order: z
      .enum(['asc', 'desc'])
      .default('desc')
      .describe(
        "Keyset sort direction over the endpoint's canonical ordering key. `desc` (default) returns newest/highest first; `asc` oldest/lowest first.",
      ),
  })
  .describe(
    'Standard cursor-pagination query for list endpoints: opaque cursor + bounded limit + order.',
  );
/** Validated list-query value. */
export type ListQuery = z.infer<typeof ListQuery>;

/** Query params for fixed-order cursor lists. */
export const CursorQuery = z
  .object({
    cursor: z
      .string()
      .optional()
      .describe("Opaque keyset cursor from a prior page's `nextCursor`; omit for the first page."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe('Maximum items to return on this page, 1..100 (default 50).'),
  })
  .describe(
    'Cursor pagination for endpoints with one documented canonical order. Copy `nextCursor` into `cursor`; omit `limit` to request the default 50 rows.',
  );
/** Validated cursor-query value. */
export type CursorQuery = z.infer<typeof CursorQuery>;

/** A page of results with an optional next-page cursor and total. */
export interface Page<T> {
  /** The page's items. */
  readonly items: T[];
  /** Cursor for the next page, absent when exhausted. */
  readonly nextCursor?: string;
  /** Optional total count across all pages. */
  readonly total?: number;
}

/** Build a Zod schema for a {@link Page} of `item` (for `*Out` response shapes). */
export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item).describe('The items on this page, in the requested order.'),
    nextCursor: z
      .string()
      .optional()
      .describe(
        'Opaque cursor to fetch the next page; pass it back as the request `cursor`. Absent when this is the last page (the result set is exhausted).',
      ),
    total: z
      .number()
      .int()
      .optional()
      .describe('Total count across all pages, when the endpoint computes it; may be omitted.'),
  });
}
