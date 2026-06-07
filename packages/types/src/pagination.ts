/**
 * `@docket/types` — cursor pagination primitives.
 */
import { z } from 'zod';

/** Query params for any list endpoint (cursor + bounded limit + order). */
export const ListQuery = z.object({
  /** Opaque cursor from a prior page's `nextCursor`. */
  cursor: z.string().optional(),
  /** Page size, 1..100 (default 50). */
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Sort direction. */
  order: z.enum(['asc', 'desc']).default('desc'),
});
/** Validated list-query value. */
export type ListQuery = z.infer<typeof ListQuery>;

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
    items: z.array(item),
    nextCursor: z.string().optional(),
    total: z.number().int().optional(),
  });
}
