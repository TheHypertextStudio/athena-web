import { z } from 'zod';

/** Task priority. */
export const Priority = z
  .enum(['none', 'urgent', 'high', 'medium', 'low'])
  .describe(
    "A Task's priority. `none`: unprioritized. `urgent`: do now / drop everything. `high`, `medium`, `low`: descending importance.",
  );

/** Priority value. */
export type Priority = z.infer<typeof Priority>;
