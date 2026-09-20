import { z } from 'zod';

/** One materialized group or subgroup with a distinct matched-item count. */
export const WorkViewGroup = z
  .object({
    path: z.array(z.string()).min(1).max(2),
    key: z.string(),
    label: z.string(),
    count: z.number().int().nonnegative(),
    mutable: z
      .boolean()
      .optional()
      .describe(
        'False for source identity groups that cannot receive native assignment mutations.',
      ),
  })
  .strict();
/** A validated materialized group or subgroup summary. */
export type WorkViewGroup = z.infer<typeof WorkViewGroup>;
