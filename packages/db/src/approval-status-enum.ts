/**
 * `@docket/db` — the approval state of a gated agent action, re-exported by `./enums`.
 *
 * @remarks
 * Kept beside the enum set rather than inside it only so that file stays within its length budget.
 */
import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Approval state of a gated agent action. `failed` is terminal: the action was approved and run,
 * its tool reported an error, and nothing changed.
 */
export const approvalStatus = pgEnum('approval_status', [
  'proposed',
  'approved',
  'executing',
  'rejected',
  'applied',
  'failed',
]);
