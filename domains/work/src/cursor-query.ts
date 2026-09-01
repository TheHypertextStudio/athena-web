import { z } from 'zod';

/** Domain-private opt-in cursor query used by the Task list contract. */
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
      .optional()
      .describe(
        'Optional page size, 1..100. Unlike `ListQuery`, there is NO default: omit it to return the full result set (legacy behavior); supply it to get a bounded keyset page plus a `nextCursor`.',
      ),
  })
  .describe(
    'Backward-compatible cursor query for endpoints that historically returned every row; `limit` is opt-in so adding it never silently truncates existing callers. Ordering is fixed newest-first.',
  );
