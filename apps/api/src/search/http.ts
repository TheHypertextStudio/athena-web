import { SearchDocumentFamily, SearchDocumentKind, SourceSystemKind } from '@docket/types';
import { z } from 'zod';

function csvEnum<T extends z.ZodEnum>(schema: T) {
  return z
    .string()
    .optional()
    .transform((value, ctx): z.infer<T>[] => {
      if (!value) return [];
      const parts = value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      const parsed = z.array(schema).safeParse(parts);
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', message: 'Invalid comma-separated filter value.' });
        return z.NEVER;
      }
      return parsed.data;
    });
}

/** HTTP query params accepted by Hub and org-scoped search endpoints. */
export const SearchHttpQuery = z.object({
  q: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  families: csvEnum(SearchDocumentFamily),
  kinds: csvEnum(SearchDocumentKind),
  sources: csvEnum(SourceSystemKind),
  orgIds: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
        : [],
    ),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});
/** Parsed search HTTP query params. */
export type SearchHttpQuery = z.infer<typeof SearchHttpQuery>;
