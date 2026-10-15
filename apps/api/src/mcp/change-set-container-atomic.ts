import { initiative, milestone, program, project, task } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { Tx, UndoOutcome } from './change-set';
import type { StoredEntry } from './change-set-companions';
import { authorizeRecordedIdentities } from './change-set-identity';
import { restoredWorkSnapshot, unchangedSince } from './change-set-values';

const tables = { initiative, program, project, milestone };
/** Non-Task work reversed inside the same transaction as its dependent companion state. */
export type AtomicContainerKind = keyof typeof tables;

/** Whether the existing atomic undo engine can reverse this ordinary container or checkpoint. */
export function isAtomicContainerKind(kind: string): kind is AtomicContainerKind {
  return Object.hasOwn(tables, kind);
}

/**
 * Defer checkpoint deletion until recorded Tasks have been archived, without relying on query order.
 * @returns Reverse replay order with created Milestones last, preserving every complete entry.
 */
export function orderedAtomicUndoEntries<T extends StoredEntry>(entries: readonly T[]): T[] {
  const reversed = [...entries].reverse();
  const isCreatedMilestone = (entry: T): boolean =>
    entry.entityKind === 'milestone' && entry.op === 'create';
  return [
    ...reversed.filter((entry) => !isCreatedMilestone(entry)),
    ...reversed.filter(isCreatedMilestone),
  ];
}

/**
 * Reverse a checked work snapshot through the caller's existing atomic receipt transaction.
 * @returns A refusal when independent edits or active checkpoint references prevent restoration.
 */
export async function revertAtomicContainer(
  entry: StoredEntry,
  orgId: string,
  tx: Tx,
): Promise<UndoOutcome> {
  const ref = { kind: entry.entityKind, id: entry.entityId };
  if (!isAtomicContainerKind(entry.entityKind))
    return { ...ref, reverted: false, reason: 'unsupported_kind' };
  const table = tables[entry.entityKind];
  const where = and(eq(table.organizationId, orgId), eq(table.id, entry.entityId));
  const [current] = await tx.select().from(table).where(where).limit(1).for('update');
  if (!current) return { ...ref, reverted: false, reason: 'gone' };
  if (entry.after && !unchangedSince(current, entry.after))
    return { ...ref, reverted: false, reason: 'changed_since' };
  switch (entry.op) {
    case 'create':
      if (entry.entityKind === 'milestone') return removeCreatedMilestone(entry, orgId, tx);
      return writeArchive(tx, {
        orgId,
        kind: entry.entityKind,
        id: entry.entityId,
        archivedAt: new Date(),
      });
    case 'archive':
      return writeArchive(tx, {
        orgId,
        kind: entry.entityKind,
        id: entry.entityId,
        archivedAt: null,
      });
    case 'update':
      if (!entry.before) return { ...ref, reverted: false, reason: 'no_prior_state' };
      await authorizeRecordedIdentities(tx, orgId, [
        { entityKind: entry.entityKind, before: entry.before },
      ]);
      await tx.update(table).set(restoredWorkSnapshot(entry.before, current)).where(where);
      return { ...ref, reverted: true };
    default:
      return { ...ref, reverted: false, reason: 'unsupported_op' };
  }
}

async function removeCreatedMilestone(
  entry: StoredEntry,
  orgId: string,
  tx: Tx,
): Promise<UndoOutcome> {
  const ref = { kind: 'milestone', id: entry.entityId };
  const [active] = await tx
    .select({ id: task.id })
    .from(task)
    .where(
      and(
        eq(task.organizationId, orgId),
        eq(task.milestoneId, entry.entityId),
        isNull(task.archivedAt),
      ),
    )
    .limit(1);
  if (active) return { ...ref, reverted: false, reason: 'in_use' };
  await tx
    .delete(milestone)
    .where(and(eq(milestone.organizationId, orgId), eq(milestone.id, entry.entityId)));
  return { ...ref, reverted: true };
}

async function writeArchive(
  tx: Tx,
  input: {
    readonly orgId: string;
    readonly kind: AtomicContainerKind;
    readonly id: string;
    readonly archivedAt: Date | null;
  },
): Promise<UndoOutcome> {
  const ref = { kind: input.kind, id: input.id };
  if (input.kind === 'milestone') return { ...ref, reverted: false, reason: 'unsupported_op' };
  const table = tables[input.kind];
  await tx
    .update(table)
    .set({ archivedAt: input.archivedAt })
    .where(and(eq(table.organizationId, input.orgId), eq(table.id, input.id)));
  return { ...ref, reverted: true };
}
