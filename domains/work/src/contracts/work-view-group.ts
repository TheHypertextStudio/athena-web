import { EntityDisplayGlyph } from './entity-display';
import { z } from 'zod';

/** One materialized group or subgroup with a distinct matched-item count. */
export const WorkViewGroup = z
  .object({
    path: z.array(z.string()).min(1).max(2),
    key: z.string(),
    label: z.string(),
    icon: EntityDisplayGlyph.nullable().optional(),
    count: z.number().int().nonnegative(),
    mutable: z
      .boolean()
      .optional()
      .describe('False for read-only groups that cannot receive assignment mutations.'),
  })
  .strict();
/** A validated materialized group or subgroup summary. */
export type WorkViewGroup = z.infer<typeof WorkViewGroup>;
