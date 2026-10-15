import { processOccurrence, type NativeScheduleDateOwnership } from '@docket/db';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { StoredChange, Tx } from './change-set';
import type { RevertResult, StoredEntry } from './change-set-companions';
import { unchangedSince } from './change-set-values';
const KIND = 'native_schedule_date_ownership';
const snapshot = z.strictObject({
  occurrenceId: z.string().min(1),
  workKind: z.enum(['task', 'project', 'milestone']),
  workId: z.string().min(1),
  field: z.enum(['startDate', 'dueDate', 'targetDate']),
  manual: z.boolean(),
  lastDerivedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});
function side(occurrenceId: string, entry: NativeScheduleDateOwnership) {
  return {
    occurrenceId,
    workKind: entry.kind,
    workId: entry.id,
    field: entry.field,
    manual: entry.manual,
    lastDerivedDate: entry.lastDerivedDate,
  };
}
/** Record action-owned native facts alongside work dates; prior authored divergence recognition is not undone with a later anchor.
 * @param inferredManualPins Internal exact field keys whose false→true recognition belongs to an earlier authored date.
 */
export function nativeScheduleDateChanges(
  occurrenceId: string,
  before: readonly NativeScheduleDateOwnership[],
  after: readonly NativeScheduleDateOwnership[],
  inferredManualPins: ReadonlySet<string> = new Set(),
): StoredChange[] {
  return after.flatMap((entry) => {
    const previous = before.find(
      (candidate) => candidate.id === entry.id && candidate.field === entry.field,
    );
    if (
      !previous ||
      (previous.manual === entry.manual && previous.lastDerivedDate === entry.lastDerivedDate)
    )
      return [];
    if (
      inferredManualPins.has(`${entry.id}:${entry.field}`) &&
      !previous.manual &&
      entry.manual &&
      previous.lastDerivedDate === entry.lastDerivedDate
    )
      return [];
    return [
      {
        kind: KIND,
        id: `${occurrenceId}:${entry.id}:${entry.field}`,
        op: 'update' as const,
        before: side(occurrenceId, previous),
        after: side(occurrenceId, entry),
      },
    ];
  });
}
/** Whether an entry belongs to the native ownership undo companion. */
export function isNativeScheduleDateKind(kind: string): boolean {
  return kind === KIND;
}
function refusal(
  entry: StoredEntry,
  after: ReturnType<typeof snapshot.safeParse>,
  reason: 'no_prior_state' | 'changed_since' | 'gone',
): RevertResult {
  return {
    outcome: {
      kind: after.success ? after.data.workKind : 'task',
      id: after.success ? after.data.workId : entry.entityId,
      reverted: false,
      reason,
    },
  };
}
function findOwnership(
  ownership: readonly NativeScheduleDateOwnership[] | null | undefined,
  right: z.infer<typeof snapshot>,
): {
  ownership: readonly NativeScheduleDateOwnership[];
  fact: NativeScheduleDateOwnership;
  index: number;
} | null {
  if (!ownership) return null;
  const index = ownership.findIndex(
    (fact) =>
      fact.kind === right.workKind && fact.id === right.workId && fact.field === right.field,
  );
  const fact = ownership[index];
  return fact ? { ownership, fact, index } : null;
}
/** Restore mutable native facts only for a persisted same-tenant exact receipt with unchanged current state. */
export async function revertNativeScheduleDate(
  entry: StoredEntry,
  orgId: string,
  tx: Tx,
): Promise<RevertResult> {
  const before = snapshot.safeParse(entry.before),
    after = snapshot.safeParse(entry.after);
  if (entry.op !== 'update' || !entry.changeSetId || !before.success || !after.success)
    return refusal(entry, after, 'no_prior_state');
  const left = before.data,
    right = after.data;
  if (
    !unchangedSince(left, { ...right, manual: left.manual, lastDerivedDate: left.lastDerivedDate })
  )
    return refusal(entry, after, 'changed_since');
  const where = and(
    eq(processOccurrence.organizationId, orgId),
    eq(processOccurrence.id, right.occurrenceId),
  );
  const [current] = await tx.select().from(processOccurrence).where(where).for('update').limit(1);
  const selected = findOwnership(current?.scheduleDateOwnership, right);
  if (!selected) return refusal(entry, after, 'gone');
  const { ownership, fact, index } = selected;
  if (!unchangedSince(side(right.occurrenceId, fact), right))
    return refusal(entry, after, 'changed_since');
  const restored = ownership.map((value, position) =>
    position === index
      ? { ...value, manual: left.manual, lastDerivedDate: left.lastDerivedDate }
      : value,
  );
  await tx.execute(
    sql`select set_config('docket.native_date_undo_entry',${entry.changeSetId},true)`,
  );
  await tx.update(processOccurrence).set({ scheduleDateOwnership: restored }).where(where);
  await tx.execute(sql`select set_config('docket.native_date_undo_entry','',true)`);
  return { outcome: { kind: right.workKind, id: right.workId, reverted: true } };
}
