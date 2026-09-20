import { z } from 'zod';

/** Domain-owned bounded cursor query used by the Task list contract. */
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
    'Bounded cursor pagination in the endpoint’s documented fixed order. Copy `nextCursor` into `cursor`; omit `limit` to request the default 50 rows.',
  );
