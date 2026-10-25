/** Snapshot binding shared by single-action and grouped human proposal decisions. */
import { sessionActivity, type db } from '@docket/db';
import { and, eq, type SQL } from 'drizzle-orm';
import { ConflictError } from '../error';

type ActivityRow = typeof sessionActivity.$inferSelect;
type ApprovalTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Bind a decision to the exact pending body that its authorization checked. */
export function reviewedProposalWhere(action: ActivityRow): SQL | undefined {
  return and(
    eq(sessionActivity.id, action.id),
    eq(sessionActivity.sessionId, action.sessionId),
    eq(sessionActivity.approvalStatus, 'proposed'),
    eq(sessionActivity.body, action.body),
  );
}

/**
 * Preserve already-settled batch members while rejecting a changed pending body.
 * @throws A conflict that rolls back the decision batch when its checked body changed.
 */
export async function rejectChangedProposal(
  tx: ApprovalTransaction,
  action: ActivityRow,
): Promise<void> {
  const [pending] = await tx
    .select({ id: sessionActivity.id })
    .from(sessionActivity)
    .where(and(eq(sessionActivity.id, action.id), eq(sessionActivity.approvalStatus, 'proposed')));
  if (pending) throw new ConflictError('Proposal changed during review');
}
