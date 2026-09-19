/**
 * `@docket/api` — reversing a recorded MCP change set.
 *
 * @remarks
 * Split out of `./change-set`, which owns the recording side. Undo is a reverse replay with
 * conflict detection, not a transaction rollback: by the time someone asks, the transaction is
 * long committed and other people have been working. Two reversal modes live here because the
 * callers want different things from a drifted row — {@link undoChangeSet} reports it as skipped
 * and carries on, while {@link undoChangeSetAtomically} refuses the whole change set.
 */
import { changeSet, changeSetEntry, db, task, taskLabel } from '@docket/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { ConflictError, NotFoundError } from '../error';
import { serializableTx } from '../lib/serializable-tx';
import {
  applySubtaskCompletionPolicyForParents,
  finishTaskStateTransition,
  writeTaskStateTransition,
  type TaskStateMutation,
} from '../lib/task-state';
import { planTaskReparents } from '../services/task-hierarchy';
import {
  endpointValues,
  isLabelIdList,
  loadRow,
  relationTable,
  restoredDate,
  restoredMetadata,
  taskPatchFromSnapshot,
  UNDO_CONFLICT,
  unchangedSince,
  type ChangeSetEntryRow,
  type TaskRow,
  type UndoResult,
} from './change-set-snapshot';
import {
  isRelation,
  RECORDABLE,
  RELATIONS,
  type RecordableKind,
  type RecordableTable,
  type RelationKind,
  type Tx,
  type UndoOutcome,
} from './change-set';

/** What an atomic reversal hands its caller inside the transaction, before it commits. */
export interface RevertedChangeSet {
  readonly tx: Tx;
  readonly entries: readonly ChangeSetEntryRow[];
  readonly outcomes: readonly UndoOutcome[];
}

/**
 * Reverse one recorded relation edge: delete what was linked, restore what was unlinked.
 *
 * @remarks
 * There is no conflict check here, because an edge has no state to have drifted — it either exists
 * or it does not, and both reversals are idempotent against whatever someone else did meanwhile.
 *
 * @param kind - The relation.
 * @param entry - The recorded endpoints.
 * @param orgId - The organization it happened in.
 * @returns what happened to it.
 */
async function revertLink(
  kind: RelationKind,
  entry: {
    entityId: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  },
  orgId: string,
): Promise<UndoOutcome> {
  const relation = RELATIONS[kind];
  const ref = { kind, id: entry.entityId };
  const edge = entry.after ?? entry.before;
  const from = edge?.['from'];
  const to = edge?.['to'];
  if (typeof from !== 'string' || typeof to !== 'string') {
    return { ...ref, reverted: false, reason: 'no_endpoints' };
  }

  const table = relationTable(kind);
  const where = and(eq(relation.from, from), eq(relation.to, to), eq(table.organizationId, orgId));
  if (entry.after) {
    await db.delete(table).where(where);
  } else {
    await db
      .insert(table)
      .values({ organizationId: orgId, ...endpointValues(kind, from, to) })
      .onConflictDoNothing();
  }
  return { ...ref, reverted: true };
}

/**
 * Take a task this change set created back out of view.
 *
 * @remarks
 * Archived rather than deleted, because an undo is a reversal of one recorded step and not a
 * licence to destroy anything that may have been linked to since.
 *
 * @param taskId - The task to archive.
 * @param orgId - The workspace it belongs to.
 */
async function archiveCreatedTask(taskId: string, orgId: string): Promise<void> {
  const cascades = await serializableTx(async (tx) => {
    const [row] = await tx
      .select()
      .from(task)
      .where(and(eq(task.id, taskId), eq(task.organizationId, orgId)))
      .for('update')
      .limit(1);
    if (!row) return [];
    await tx
      .update(task)
      .set({ archivedAt: new Date() })
      .where(and(eq(task.id, taskId), eq(task.organizationId, orgId)));
    return applySubtaskCompletionPolicyForParents(tx, orgId, [row.parentTaskId]);
  });
  for (const cascade of cascades) await finishTaskStateTransition({ actorId: null }, cascade);
}

/** The recorded state a task is restored to, once it is known to be complete enough to use. */
interface PriorTaskState {
  readonly snapshot: Record<string, unknown>;
  readonly statusId: string;
  readonly state: string;
  readonly parentTaskId: string | null;
}

/**
 * Read the prior state one entry recorded, when it recorded enough to restore.
 *
 * @param entry - The change-set entry.
 * @returns The prior state, or `null` when the entry cannot be reversed.
 */
function priorTaskState(entry: {
  op: string;
  before: Record<string, unknown> | null;
}): PriorTaskState | null {
  if (entry.op !== 'update' || !entry.before) return null;
  const snapshot = entry.before;
  const statusId = snapshot['statusId'];
  const state = snapshot['state'];
  const parentTaskId = snapshot['parentTaskId'];
  if (typeof statusId !== 'string' || typeof state !== 'string') return null;
  if (parentTaskId !== null && typeof parentTaskId !== 'string') return null;
  return { snapshot, statusId, state, parentTaskId };
}

/** What restoring one task snapshot produced, for the caller to publish after commit. */
interface RestoredTask {
  readonly mutation: Awaited<ReturnType<typeof writeTaskStateTransition>>;
  readonly cascades: Awaited<ReturnType<typeof applySubtaskCompletionPolicyForParents>>;
}

/**
 * Put one task back the way the change set found it.
 *
 * @remarks
 * Every task in the workspace is locked in a stable order first. Restoring an archived child can
 * otherwise race a reparent and reintroduce a cycle after either side completed its own
 * reachability check.
 *
 * @param taskId - The task to restore.
 * @param orgId - The workspace it belongs to.
 * @param prior - The recorded state to restore.
 * @returns The transitions to publish, or `null` when the task is gone.
 */
async function restoreTaskSnapshot(
  taskId: string,
  orgId: string,
  prior: PriorTaskState,
): Promise<RestoredTask | null> {
  return serializableTx(async (tx) => {
    const rows = await tx
      .select()
      .from(task)
      .where(eq(task.organizationId, orgId))
      .orderBy(task.id)
      .for('update');
    const row = rows.find((candidate) => candidate.id === taskId);
    if (!row) return null;
    const archivedAt = restoredDate(prior.snapshot['archivedAt']);
    if (archivedAt === null) {
      const activeRows = rows.filter(
        (candidate) => candidate.archivedAt === null || candidate.id === row.id,
      );
      planTaskReparents(activeRows, [{ taskId: row.id, parentTaskId: prior.parentTaskId }], false);
    }

    await tx
      .update(task)
      .set({ ...restoredMetadata(prior.snapshot), archivedAt })
      .where(and(eq(task.id, row.id), eq(task.organizationId, orgId)));
    const parents = [row.parentTaskId, prior.parentTaskId];
    if (archivedAt !== null) {
      return {
        mutation: null,
        cascades: await applySubtaskCompletionPolicyForParents(tx, orgId, parents),
      };
    }
    const mutation = await writeTaskStateTransition(tx, {
      before: row,
      statusId: prior.statusId,
      state: prior.state,
      completedAt: restoredDate(prior.snapshot['completedAt']),
      canceledAt: restoredDate(prior.snapshot['canceledAt']),
      autoCompletedBySubtasks: prior.snapshot['autoCompletedBySubtasks'] === true,
    });
    if (!mutation) return null;
    return {
      mutation,
      cascades: await applySubtaskCompletionPolicyForParents(tx, orgId, parents),
    };
  });
}

/** Restore a task through the state and hierarchy boundaries rather than a raw row update. */
async function revertTask(
  entry: {
    entityId: string;
    op: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  },
  orgId: string,
): Promise<UndoOutcome> {
  const ref = { kind: 'task', id: entry.entityId };
  const current = await loadRow('task', orgId, entry.entityId);
  if (!current) return { ...ref, reverted: false, reason: 'gone' };
  if (entry.after && !unchangedSince(current, entry.after)) {
    return { ...ref, reverted: false, reason: 'changed_since' };
  }

  if (entry.op === 'create') {
    await archiveCreatedTask(entry.entityId, orgId);
    return { ...ref, reverted: true };
  }
  const prior = priorTaskState(entry);
  if (!prior) return { ...ref, reverted: false, reason: 'no_prior_state' };

  const result = await restoreTaskSnapshot(entry.entityId, orgId, prior);
  if (!result) return { ...ref, reverted: false, reason: 'gone' };
  if (result.mutation) await finishTaskStateTransition({ actorId: null }, result.mutation);
  for (const cascade of result.cascades) {
    await finishTaskStateTransition({ actorId: null }, cascade);
  }
  return { ...ref, reverted: true };
}

/**
 * Reverse one recorded entry.
 *
 * @param entry - The recorded change.
 * @param orgId - The organization it happened in.
 * @returns what happened to it.
 */
async function revertEntry(
  entry: {
    entityKind: string;
    entityId: string;
    op: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  },
  orgId: string,
): Promise<UndoOutcome> {
  if (isRelation(entry.entityKind)) return revertLink(entry.entityKind, entry, orgId);

  const kind = entry.entityKind as RecordableKind;
  const ref = { kind: entry.entityKind, id: entry.entityId };
  if (!(kind in RECORDABLE)) return { ...ref, reverted: false, reason: 'unsupported_kind' };
  if (kind === 'task') return revertTask(entry, orgId);

  const table = RECORDABLE[kind] as RecordableTable;
  const current = await loadRow(kind, orgId, entry.entityId);
  if (!current) return { ...ref, reverted: false, reason: 'gone' };
  if (entry.after && !unchangedSince(current, entry.after)) {
    return { ...ref, reverted: false, reason: 'changed_since' };
  }

  const where = and(eq(table.id, entry.entityId), eq(table.organizationId, orgId));
  switch (entry.op) {
    case 'create':
      // Undoing a create archives rather than deletes: the row may already be referenced, and a
      // hard delete would take those references with it.
      await db.update(table).set({ archivedAt: new Date() }).where(where);
      return { ...ref, reverted: true };
    case 'archive':
      await db.update(table).set({ archivedAt: null }).where(where);
      return { ...ref, reverted: true };
    case 'update':
      if (!entry.before) return { ...ref, reverted: false, reason: 'no_prior_state' };
      await db.update(table).set(entry.before).where(where);
      return { ...ref, reverted: true };
    default:
      return { ...ref, reverted: false, reason: 'unsupported_op' };
  }
}

/**
 * Reverse a change set, reporting what it could not take back.
 *
 * @remarks
 * Entries revert in reverse insertion order so a call that created a project and then filed tasks
 * into it unwinds children-first. A partial undo is a normal outcome, not an error: the caller
 * gets a per-entity account and decides what to do about the remainder.
 *
 * @param orgId - The organization the change happened in.
 * @param changeSetId - The change set to reverse.
 * @returns the summary it reverses and the per-entity outcomes.
 * @throws {NotFoundError} When the change set is not this org's, or was already undone.
 */
export async function undoChangeSet(orgId: string, changeSetId: string): Promise<UndoResult> {
  const sets = await db
    .select({ id: changeSet.id, summary: changeSet.summary })
    .from(changeSet)
    .where(
      and(
        eq(changeSet.id, changeSetId),
        eq(changeSet.organizationId, orgId),
        isNull(changeSet.undoneAt),
      ),
    )
    .limit(1);
  const set = sets[0];
  if (!set) throw new NotFoundError('Change set not found');

  const entries = await db
    .select()
    .from(changeSetEntry)
    .where(eq(changeSetEntry.changeSetId, changeSetId));

  const outcomes: UndoOutcome[] = [];
  for (const entry of [...entries].reverse()) {
    outcomes.push(await revertEntry(entry, orgId));
  }
  await db.update(changeSet).set({ undoneAt: new Date() }).where(eq(changeSet.id, changeSetId));
  return { summary: set.summary, outcomes };
}

/**
 * Take the change set itself under lock, so two undos cannot both claim it.
 *
 * @param tx - The open transaction.
 * @param orgId - The organization it happened in.
 * @param changeSetId - The change set to reverse.
 * @returns the locked header.
 * @throws {NotFoundError} When the change set is not this org's, or was already undone.
 */
async function lockUndoableChangeSet(
  tx: Tx,
  orgId: string,
  changeSetId: string,
): Promise<{ id: string; summary: string }> {
  const [set] = await tx
    .select({ id: changeSet.id, summary: changeSet.summary })
    .from(changeSet)
    .where(
      and(
        eq(changeSet.id, changeSetId),
        eq(changeSet.organizationId, orgId),
        isNull(changeSet.undoneAt),
      ),
    )
    .for('update')
    .limit(1);
  if (!set) throw new NotFoundError('Change set not found');
  return set;
}

/**
 * Lock every task this change set touched and confirm none of them drifted.
 *
 * @param tx - The open transaction.
 * @param orgId - The organization it happened in.
 * @param entries - Every entry in the change set.
 * @returns the locked rows by id.
 * @throws {ConflictError} When a task is gone or no longer matches its recorded after-state.
 */
async function lockUnchangedTaskRows(
  tx: Tx,
  orgId: string,
  entries: readonly ChangeSetEntryRow[],
): Promise<Map<string, TaskRow>> {
  const taskEntries = entries.filter((entry) => entry.entityKind === 'task');
  const taskIds = [...new Set(taskEntries.map((entry) => entry.entityId))].sort();
  const rows =
    taskIds.length === 0
      ? []
      : await tx
          .select()
          .from(task)
          .where(and(eq(task.organizationId, orgId), inArray(task.id, taskIds)))
          .orderBy(task.id)
          .for('update');
  const rowById = new Map(rows.map((row) => [row.id, row]));
  for (const entry of taskEntries) {
    const row = rowById.get(entry.entityId);
    if (!row) throw new ConflictError(UNDO_CONFLICT);
    if (entry.after && !unchangedSince(row, entry.after)) {
      throw new ConflictError(UNDO_CONFLICT);
    }
  }
  return rowById;
}

/**
 * Lock every label set this change set wrote and confirm none of them drifted.
 *
 * @param tx - The open transaction.
 * @param orgId - The organization it happened in.
 * @param entries - Every entry in the change set.
 * @throws {ConflictError} When a task's labels no longer match its recorded after-state.
 */
async function assertLabelsUnchanged(
  tx: Tx,
  orgId: string,
  entries: readonly ChangeSetEntryRow[],
): Promise<void> {
  const labelEntries = entries.filter((entry) => entry.entityKind === 'task_labels');
  const taskIds = [...new Set(labelEntries.map((entry) => entry.entityId))].sort();
  const rows =
    taskIds.length === 0
      ? []
      : await tx
          .select({ taskId: taskLabel.taskId, labelId: taskLabel.labelId })
          .from(taskLabel)
          .where(and(eq(taskLabel.organizationId, orgId), inArray(taskLabel.taskId, taskIds)))
          .orderBy(taskLabel.taskId, taskLabel.labelId)
          .for('update');
  const labelsByTaskId = new Map<string, string[]>();
  for (const row of rows) {
    const ids = labelsByTaskId.get(row.taskId) ?? [];
    ids.push(row.labelId);
    labelsByTaskId.set(row.taskId, ids);
  }
  for (const entry of labelEntries) {
    const expected = entry.after?.['labelIds'];
    if (!isLabelIdList(expected)) throw new ConflictError(UNDO_CONFLICT);
    const current = [...(labelsByTaskId.get(entry.entityId) ?? [])].sort();
    if (current.length !== expected.length || current.some((id, i) => id !== expected[i])) {
      throw new ConflictError(UNDO_CONFLICT);
    }
  }
}

/**
 * Reverse one task entry against its locked row.
 *
 * @param tx - The open transaction.
 * @param orgId - The organization it happened in.
 * @param entry - The recorded change.
 * @param row - The locked task row.
 * @returns the subtask-policy cascades to publish after commit.
 * @throws {ConflictError} When the entry records an op this reversal cannot undo.
 */
async function revertTaskInTx(
  tx: Tx,
  orgId: string,
  entry: ChangeSetEntryRow,
  row: TaskRow,
): Promise<readonly TaskStateMutation[]> {
  const where = and(eq(task.id, row.id), eq(task.organizationId, orgId));
  if (entry.op === 'create') {
    await tx.update(task).set({ archivedAt: new Date() }).where(where);
    return applySubtaskCompletionPolicyForParents(tx, orgId, [row.parentTaskId]);
  }
  if (entry.op === 'update' && entry.before) {
    await tx.update(task).set(taskPatchFromSnapshot(entry.before)).where(where);
    return [];
  }
  throw new ConflictError(UNDO_CONFLICT);
}

/**
 * Put one task's labels back to the recorded set.
 *
 * @param tx - The open transaction.
 * @param orgId - The organization it happened in.
 * @param entry - The recorded change.
 * @throws {ConflictError} When the entry did not record a usable prior label set.
 */
async function revertTaskLabelsInTx(
  tx: Tx,
  orgId: string,
  entry: ChangeSetEntryRow,
): Promise<void> {
  const labelIds = entry.before?.['labelIds'];
  if (!isLabelIdList(labelIds)) throw new ConflictError(UNDO_CONFLICT);
  await tx
    .delete(taskLabel)
    .where(and(eq(taskLabel.organizationId, orgId), eq(taskLabel.taskId, entry.entityId)));
  if (labelIds.length === 0) return;
  await tx.insert(taskLabel).values(
    labelIds.map((labelId) => ({
      organizationId: orgId,
      taskId: entry.entityId,
      labelId,
    })),
  );
}

/**
 * Delete one edge this change set linked, under lock.
 *
 * @param tx - The open transaction.
 * @param orgId - The organization it happened in.
 * @param kind - The relation.
 * @param entry - The recorded endpoints.
 * @throws {ConflictError} When the entry unlinked rather than linked, or the edge is already gone.
 */
async function revertRelationInTx(
  tx: Tx,
  orgId: string,
  kind: RelationKind,
  entry: ChangeSetEntryRow,
): Promise<void> {
  const edge = entry.after ?? entry.before;
  const from = edge?.['from'];
  const to = edge?.['to'];
  if (typeof from !== 'string' || typeof to !== 'string' || !entry.after) {
    throw new ConflictError(UNDO_CONFLICT);
  }
  const relation = RELATIONS[kind];
  const table = relationTable(kind);
  const where = and(eq(relation.from, from), eq(relation.to, to), eq(table.organizationId, orgId));
  const current = await tx
    .select({ from: relation.from, to: relation.to })
    .from(table)
    .where(where)
    .for('update');
  if (current.length !== 1) throw new ConflictError(UNDO_CONFLICT);
  await tx.delete(table).where(where);
}

/**
 * Reverse one entry of an atomic undo.
 *
 * @param tx - The open transaction.
 * @param orgId - The organization it happened in.
 * @param entry - The recorded change.
 * @param rowById - The locked task rows.
 * @returns the subtask-policy cascades to publish after commit.
 * @throws {ConflictError} When the entry cannot be reversed.
 */
async function revertEntryInTx(
  tx: Tx,
  orgId: string,
  entry: ChangeSetEntryRow,
  rowById: ReadonlyMap<string, TaskRow>,
): Promise<readonly TaskStateMutation[]> {
  if (entry.entityKind === 'task') {
    const row = rowById.get(entry.entityId);
    if (!row) throw new ConflictError(UNDO_CONFLICT);
    return revertTaskInTx(tx, orgId, entry, row);
  }
  if (entry.entityKind === 'task_labels') {
    await revertTaskLabelsInTx(tx, orgId, entry);
    return [];
  }
  if (!isRelation(entry.entityKind)) throw new ConflictError(UNDO_CONFLICT);
  await revertRelationInTx(tx, orgId, entry.entityKind, entry);
  return [];
}

/**
 * Reverse one change set only when every tracked task still matches its recorded after-state.
 *
 * @param orgId - The organization the change happened in.
 * @param changeSetId - The change set to reverse.
 * @param onReverted - Called inside the transaction once every entry is reversed.
 * @returns the summary it reverses and the per-entity outcomes.
 * @throws {NotFoundError} When the change set is not this org's, or was already undone.
 * @throws {ConflictError} When anything the change set wrote has moved on since.
 */
export async function undoChangeSetAtomically(
  orgId: string,
  changeSetId: string,
  onReverted?: (input: RevertedChangeSet) => Promise<void>,
): Promise<UndoResult> {
  const result = await serializableTx(async (tx) => {
    const set = await lockUndoableChangeSet(tx, orgId, changeSetId);
    const entries = await tx
      .select()
      .from(changeSetEntry)
      .where(eq(changeSetEntry.changeSetId, changeSetId));
    const rowById = await lockUnchangedTaskRows(tx, orgId, entries);
    await assertLabelsUnchanged(tx, orgId, entries);

    const outcomes: UndoOutcome[] = [];
    const cascades: TaskStateMutation[] = [];
    for (const entry of [...entries].reverse()) {
      cascades.push(...(await revertEntryInTx(tx, orgId, entry, rowById)));
      outcomes.push({ kind: entry.entityKind, id: entry.entityId, reverted: true });
    }
    if (onReverted) await onReverted({ tx, entries, outcomes });
    await tx.update(changeSet).set({ undoneAt: new Date() }).where(eq(changeSet.id, changeSetId));
    return { summary: set.summary, outcomes, cascades };
  });
  for (const cascade of result.cascades) {
    await finishTaskStateTransition({ actorId: null }, cascade);
  }
  return { summary: result.summary, outcomes: result.outcomes };
}
