import { retainedDateOwnership, type RetainedDateOwnershipMutation } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { StoredChange, Tx } from './change-set';
import type { RevertResult, StoredEntry } from './change-set-companions';
import { unchangedSince } from './change-set-values';

const KIND = 'retained_date_ownership';
const snapshot = z.strictObject({
  occurrenceId: z.string().min(1),
  sourceStepId: z.string().min(1),
  invocationId: z.string().min(1),
  workKind: z.enum(['task', 'project', 'milestone']),
  workId: z.string().min(1),
  field: z.enum(['startDate', 'dueDate', 'targetDate']),
  manual: z.boolean(),
  lastDerivedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});
function side(row: RetainedDateOwnershipMutation['before']) {
  return {
    occurrenceId: row.occurrenceId,
    sourceStepId: row.sourceStepId,
    invocationId: row.invocationId,
    workKind: row.workKind,
    workId: row.workId,
    field: row.field,
    manual: row.manual,
    lastDerivedDate: row.lastDerivedDate,
  };
}
/** Include exact private ownership changes in the work mutation's existing receipt, without copying rules. */
export function retainedDateOwnershipChange(change: RetainedDateOwnershipMutation): StoredChange {
  return {
    kind: KIND,
    id: `${change.after.occurrenceId}:${change.after.sourceStepId}:${change.after.field}`,
    op: 'update',
    before: side(change.before),
    after: side(change.after),
  };
}
/** Whether the existing companion dispatcher owns a private accepted-date snapshot. */
export function isRetainedDateOwnershipKind(kind: string): boolean {
  return kind === KIND;
}
/** Restore only accepted ownership when its immutable mapping and recorded after-value still match. */
export async function revertRetainedDateOwnership(
  entry: StoredEntry,
  orgId: string,
  tx: Tx,
): Promise<RevertResult> {
  const before = snapshot.safeParse(entry.before),
    after = snapshot.safeParse(entry.after);
  const ref = {
    kind: after.success ? after.data.workKind : 'task',
    id: after.success ? after.data.workId : entry.entityId,
  };
  if (entry.op !== 'update' || !before.success || !after.success)
    return { outcome: { ...ref, reverted: false, reason: 'no_prior_state' } };
  const left = before.data,
    right = after.data;
  if (
    !unchangedSince(left, { ...right, manual: left.manual, lastDerivedDate: left.lastDerivedDate })
  )
    return { outcome: { ...ref, reverted: false, reason: 'changed_since' } };
  const where = and(
    eq(retainedDateOwnership.organizationId, orgId),
    eq(retainedDateOwnership.occurrenceId, right.occurrenceId),
    eq(retainedDateOwnership.sourceStepId, right.sourceStepId),
    eq(retainedDateOwnership.invocationId, right.invocationId),
    eq(retainedDateOwnership.workKind, right.workKind),
    eq(retainedDateOwnership.workId, right.workId),
    eq(retainedDateOwnership.field, right.field),
  );
  const [current] = await tx
    .select()
    .from(retainedDateOwnership)
    .where(where)
    .limit(1)
    .for('update');
  if (!current) return { outcome: { ...ref, reverted: false, reason: 'gone' } };
  if (!unchangedSince(current, { manual: right.manual, lastDerivedDate: right.lastDerivedDate }))
    return { outcome: { ...ref, reverted: false, reason: 'changed_since' } };
  await tx
    .update(retainedDateOwnership)
    .set({ manual: left.manual, lastDerivedDate: left.lastDerivedDate })
    .where(where);
  return { outcome: { ...ref, reverted: true } };
}
