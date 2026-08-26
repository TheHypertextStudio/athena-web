/**
 * `@docket/api` — recording and reversing MCP change sets.
 *
 * @remarks
 * The MCP surface executes writes immediately rather than proposing them, which is a bet on
 * velocity. That bet only holds if the caller can see what happened and take it back, so every
 * tool that mutates records what it touched and what the rows looked like first.
 *
 * Undo is a reverse replay with conflict detection, not a transaction rollback: by the time
 * someone asks, the transaction is long committed and other people have been working. An entry
 * whose current state no longer matches what this change set left is reported as skipped, never
 * clobbered — reversing your own change must not quietly discard someone else's.
 */
import {
  changeSet,
  changeSetEntry,
  type ChangeOrigin,
  db,
  genId,
  initiative,
  initiativeProgram,
  initiativeProject,
  program,
  project,
  projectDependency,
  projectLabel,
  task,
  taskDependency,
  taskLabel,
  taskRelatedTask,
} from '@docket/db';
import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';

import { ConflictError, NotFoundError } from '../error';
import { serializableTx } from '../lib/serializable-tx';
import {
  applySubtaskCompletionPolicyForParents,
  finishTaskStateTransition,
  writeTaskStateTransition,
  type TaskStateMutation,
} from '../lib/task-state';
import { planTaskReparents } from '../services/task-hierarchy';

/** The entity kinds a change set can record, mapped to the table they live in. */
const RECORDABLE = { task, project, program, initiative } as const;

/** One recordable entity kind. */
export type RecordableKind = keyof typeof RECORDABLE;

/** The columns every recordable row exposes to change-set reads and reversals. */
type RecordableTable = PgTable & {
  id: AnyPgColumn;
  organizationId: AnyPgColumn;
  archivedAt: AnyPgColumn;
};

/**
 * The relations a change set can record, mapped to the join table and endpoint columns.
 *
 * @remarks
 * Kept apart from {@link RECORDABLE} because a relation has no row state to restore — reversing
 * one means deleting or re-inserting an edge, not writing columns back. Subtask parentage is
 * deliberately absent: it lives in a column on `task`, so it reverses through the ordinary update
 * path rather than needing an entry of its own.
 */
const RELATIONS = {
  blocks: {
    table: taskDependency,
    from: taskDependency.blockingTaskId,
    to: taskDependency.blockedTaskId,
  },
  project_blocks: {
    table: projectDependency,
    from: projectDependency.blockingProjectId,
    to: projectDependency.blockedProjectId,
  },
  task_has_label: {
    table: taskLabel,
    from: taskLabel.taskId,
    to: taskLabel.labelId,
  },
  project_has_label: {
    table: projectLabel,
    from: projectLabel.projectId,
    to: projectLabel.labelId,
  },
  related_task: {
    table: taskRelatedTask,
    from: taskRelatedTask.taskId,
    to: taskRelatedTask.relatedTaskId,
  },
  project_contributes_to: {
    table: initiativeProject,
    from: initiativeProject.projectId,
    to: initiativeProject.initiativeId,
  },
  program_contributes_to: {
    table: initiativeProgram,
    from: initiativeProgram.programId,
    to: initiativeProgram.initiativeId,
  },
} as const;

/** One recordable relation. */
export type RelationKind = keyof typeof RELATIONS;

/** Whether a recorded `entityKind` names a relation rather than an entity. */
function isRelation(kind: string): kind is RelationKind {
  return kind in RELATIONS;
}

/** The composite key a relation entry is stored under, since an edge has no id of its own. */
export function edgeKey(from: string, to: string): string {
  return `${from}:${to}`;
}

/**
 * The columns a change set records per kind, and the only ones undo restores.
 *
 * @remarks
 * Recording the whole row would make undo refuse on any unrelated edit — `updatedAt` alone would
 * defeat it. Narrowing to the fields a tool can actually write is what lets undo work on a live
 * workspace rather than only an untouched one. `archivedAt` is here because archive is a recorded
 * op; the external-provenance columns are not, because no tool on this surface writes them.
 */
const TRACKED: Record<RecordableKind, readonly string[]> = {
  task: [
    'title',
    'description',
    'state',
    'statusId',
    'priority',
    'assigneeId',
    'delegateId',
    'projectId',
    'programId',
    'milestoneId',
    'cycleId',
    'parentTaskId',
    'teamId',
    'templateId',
    'estimate',
    'estimateMinutes',
    'startDate',
    'dueDate',
    'estimate',
    'completedAt',
    'canceledAt',
    'autoCompletedBySubtasks',
    'archivedAt',
  ],
  project: [
    'name',
    'description',
    'status',
    'statusId',
    'priority',
    'health',
    'leadId',
    'programId',
    'teamId',
    'startDate',
    'startDateResolution',
    'startDateFiscalYearStartMonth',
    'targetDate',
    'targetDateResolution',
    'targetDateFiscalYearStartMonth',
    'archivedAt',
  ],
  program: ['name', 'description', 'status', 'health', 'ownerId', 'archivedAt'],
  initiative: [
    'name',
    'description',
    'status',
    'health',
    'priority',
    'ownerId',
    'targetDate',
    'targetDateResolution',
    'targetDateFiscalYearStartMonth',
    'archivedAt',
  ],
};

/**
 * Project a row down to the fields a change set tracks for its kind.
 *
 * @param kind - The entity kind.
 * @param row - The full row.
 * @returns the tracked subset.
 */
export function trackedFields(
  kind: RecordableKind,
  row: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(TRACKED[kind].map((key) => [key, row[key]]));
}

/** A single recorded change to one entity, before it is written. */
export interface ChangeRecord {
  readonly kind: RecordableKind;
  readonly id: string;
  readonly op: 'create' | 'update' | 'archive';
  /** The row as it was, for an update or archive. Absent on a create. */
  readonly before?: Record<string, unknown>;
  /** The row as it now is, for a create or update. Absent on an archive. */
  readonly after?: Record<string, unknown>;
}

/**
 * A single recorded change to a relation, before it is written.
 *
 * @remarks
 * `linked` says which direction the change went, which is all undo needs: reversing a link deletes
 * the edge, reversing an unlink puts it back.
 */
export interface LinkRecord {
  readonly kind: RelationKind;
  readonly from: string;
  readonly to: string;
  readonly linked: boolean;
}

/** A complete task-label snapshot for one mutation that replaces the label set. */
export interface TaskLabelsRecord {
  readonly kind: 'task_labels';
  readonly taskId: string;
  /** Exact sorted label ids before the replacement. */
  readonly before: readonly string[];
  /** Exact sorted label ids after the replacement. */
  readonly after: readonly string[];
}

/** Anything a tool can record. */
export type RecordedChange = ChangeRecord | LinkRecord | TaskLabelsRecord;

/** Whether a recorded change describes a relation rather than an entity. */
function isLinkRecord(change: RecordedChange): change is LinkRecord {
  return 'linked' in change;
}

/** Whether this entry is the explicit complete snapshot of a task's labels. */
function isTaskLabelsRecord(change: RecordedChange): change is TaskLabelsRecord {
  return change.kind === 'task_labels';
}

/** What an undo did, per entity. */
export interface UndoOutcome {
  readonly kind: string;
  readonly id: string;
  readonly reverted: boolean;
  /** Why it was left alone, when it was. */
  readonly reason?: string;
}

/** The input shared by standalone and caller-owned change-set writes. */
export interface RecordChangeSetInput {
  /** Stable caller-owned id when the caller already has an idempotency key. */
  id?: string;
  /** Persist the command header even when the normalized change list is empty. */
  recordEmpty?: boolean;
  readonly orgId: string;
  readonly actorId: string;
  readonly origin: ChangeOrigin;
  readonly summary: string;
  readonly changes: readonly RecordedChange[];
}

/** The database transaction handle used by reversible operations. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Insert a change-set record and entries through an active transaction. */
async function insertChangeSet(
  tx: Tx,
  id: string,
  input: {
    orgId: string;
    actorId: string;
    origin: ChangeOrigin;
    summary: string;
    changes: readonly RecordedChange[];
  },
): Promise<void> {
  await tx.insert(changeSet).values({
    id,
    organizationId: input.orgId,
    actorId: input.actorId,
    origin: input.origin,
    summary: input.summary,
  });
  if (input.changes.length === 0) return;
  const entries = input.changes.map((change) =>
    isTaskLabelsRecord(change)
      ? {
          changeSetId: id,
          entityKind: change.kind,
          entityId: change.taskId,
          op: 'update' as const,
          before: { labelIds: [...change.before].sort() },
          after: { labelIds: [...change.after].sort() },
        }
      : isLinkRecord(change)
        ? {
            changeSetId: id,
            entityKind: change.kind,
            entityId: edgeKey(change.from, change.to),
            op: 'link' as const,
            before: change.linked ? null : { from: change.from, to: change.to },
            after: change.linked ? { from: change.from, to: change.to } : null,
          }
        : {
            changeSetId: id,
            entityKind: change.kind,
            entityId: change.id,
            op: change.op,
            before: change.before ?? null,
            after: change.after ?? null,
          },
  );
  const batchSize = 500;
  for (let offset = 0; offset < entries.length; offset += batchSize) {
    await tx
      .insert(changeSetEntry)
      .values(entries.slice(offset, offset + batchSize))
      .onConflictDoNothing();
  }
}

/** Record a whole reversible operation in the same transaction as its writes. */
export async function recordChangeSetInTransaction(
  tx: Tx,
  input: {
    orgId: string;
    actorId: string;
    origin: ChangeOrigin;
    summary: string;
    changes: readonly RecordedChange[];
  },
): Promise<string | null> {
  if (input.changes.length === 0) return null;
  const id = genId();
  await insertChangeSet(tx, id, input);
  return id;
}

/**
 * Record a completed tool call as an undoable change set.
 *
 * @remarks
 * Called after the writes commit, not inside them: a change set that rolled back with its own
 * transaction would leave a caller unable to undo a change that did happen, which is the wrong way
 * round. A failure to record is therefore a real failure — unlike a missed notification, losing
 * the record means losing the undo.
 *
 * @param input - The org, acting actor, origin, summary, and the entities touched.
 * @returns the new change-set id, or null when nothing was touched.
 */
export async function recordChangeSet(input: {
  orgId: string;
  actorId: string;
  origin: ChangeOrigin;
  summary: string;
  changes: readonly RecordedChange[];
}): Promise<string | null> {
  if (input.changes.length === 0) return null;
  const id = genId();
  await db.transaction(async (tx) => {
    await insertChangeSet(tx, id, input);
  });
  return id;
}

/**
 * Record a completed tool call as an undoable change set in its own transaction.
 *
 * @param input - The org, acting actor, origin, summary, and entities touched.
 * @returns the new change-set id, or null when nothing was touched.
 */
/** Build a durable change-set id from one actor-scoped canvas command id. */
export function objectCommandChangeSetId(
  orgId: string,
  actorId: string,
  commandId: string,
): string {
  const digest = createHash('sha256')
    .update(orgId)
    .update('\0')
    .update(actorId)
    .update('\0')
    .update(commandId)
    .digest('hex');
  return `canvas_${digest}`;
}

/** Record a change set inside a caller-owned transaction. */
export async function recordChangeSetInTx(
  tx: Tx,
  input: RecordChangeSetInput,
): Promise<string | null> {
  if (input.changes.length === 0 && input.recordEmpty !== true) return null;
  const id = input.id ?? genId();
  await insertChangeSet(tx, id, input);
  return id;
}

/**
 * Whether a row still looks the way this change set left it.
 *
 * @remarks
 * Compares only the fields the change actually wrote. A change set that set `priority` should not
 * refuse to undo because someone edited the title afterwards — the narrow comparison is what makes
 * undo useful on a live workspace rather than only on an untouched one.
 *
 * @param current - The row as it is now.
 * @param after - The row as this change set left it.
 * @returns true when every field this change wrote is unchanged.
 */
function unchangedSince(current: Record<string, unknown>, after: Record<string, unknown>): boolean {
  return Object.entries(after).every(([key, value]) => {
    const now = current[key];
    // Dates and enums round-trip through JSON as strings; compare on that footing.
    const normalize = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : v);
    return normalize(now) === normalize(value);
  });
}

/** Load one recordable row by id, or null when it is gone. */
async function loadRow(
  kind: RecordableKind,
  orgId: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const table = RECORDABLE[kind] as RecordableTable;
  const rows = await db
    .select()
    .from(table)
    .where(and(eq(table.id, id), eq(table.organizationId, orgId)))
    .limit(1);
  return rows[0] ?? null;
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

  const table = relation.table as PgTable & { organizationId: AnyPgColumn };
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

/** The endpoint columns for a relation, named as the join table spells them. */
function endpointValues(kind: RelationKind, from: string, to: string): Record<string, string> {
  switch (kind) {
    case 'blocks':
      return { blockingTaskId: from, blockedTaskId: to };
    case 'project_blocks':
      return { blockingProjectId: from, blockedProjectId: to };
    case 'task_has_label':
      return { taskId: from, labelId: to };
    case 'project_has_label':
      return { projectId: from, labelId: to };
    case 'related_task':
      return { taskId: from, relatedTaskId: to };
    case 'project_contributes_to':
      return { projectId: from, initiativeId: to };
    case 'program_contributes_to':
      return { programId: from, initiativeId: to };
  }
}

/** Parse a JSON round-tripped nullable date from a recorded row. */
function restoredDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value !== 'string') throw new Error('Recorded task timestamp is invalid');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Recorded task timestamp is invalid');
  return date;
}

/** Turn a tracked task snapshot back into a Drizzle task patch. */
function taskPatchFromSnapshot(snapshot: Record<string, unknown>): Record<string, unknown> {
  return {
    title: snapshot['title'],
    description: snapshot['description'],
    state: snapshot['state'],
    statusId: snapshot['statusId'],
    priority: snapshot['priority'],
    assigneeId: snapshot['assigneeId'],
    delegateId: snapshot['delegateId'],
    projectId: snapshot['projectId'],
    programId: snapshot['programId'],
    milestoneId: snapshot['milestoneId'],
    cycleId: snapshot['cycleId'],
    parentTaskId: snapshot['parentTaskId'],
    teamId: snapshot['teamId'],
    templateId: snapshot['templateId'],
    estimate: snapshot['estimate'],
    estimateMinutes: snapshot['estimateMinutes'],
    startDate: restoredDate(snapshot['startDate']),
    dueDate: restoredDate(snapshot['dueDate']),
    completedAt: restoredDate(snapshot['completedAt']),
    canceledAt: restoredDate(snapshot['canceledAt']),
    autoCompletedBySubtasks: snapshot['autoCompletedBySubtasks'] === true,
    archivedAt: restoredDate(snapshot['archivedAt']),
  };
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
    const cascades = await serializableTx(async (tx) => {
      const [row] = await tx
        .select()
        .from(task)
        .where(and(eq(task.id, entry.entityId), eq(task.organizationId, orgId)))
        .for('update')
        .limit(1);
      if (!row) return [];
      await tx
        .update(task)
        .set({ archivedAt: new Date() })
        .where(and(eq(task.id, entry.entityId), eq(task.organizationId, orgId)));
      return applySubtaskCompletionPolicyForParents(tx, orgId, [row.parentTaskId]);
    });
    for (const cascade of cascades) await finishTaskStateTransition({ actorId: null }, cascade);
    return { ...ref, reverted: true };
  }
  if (entry.op !== 'update' || !entry.before) {
    return { ...ref, reverted: false, reason: 'no_prior_state' };
  }

  const prior = entry.before;
  const statusId = prior['statusId'];
  const state = prior['state'];
  const parentTaskId = prior['parentTaskId'];
  if (typeof statusId !== 'string' || typeof state !== 'string') {
    return { ...ref, reverted: false, reason: 'no_prior_state' };
  }
  if (parentTaskId !== null && typeof parentTaskId !== 'string') {
    return { ...ref, reverted: false, reason: 'no_prior_state' };
  }

  const result = await serializableTx(async (tx) => {
    // Lock every task in a stable order. Restoring an archived child can otherwise race a
    // reparent and reintroduce a cycle after either side completed its own reachability check.
    const rows = await tx
      .select()
      .from(task)
      .where(eq(task.organizationId, orgId))
      .orderBy(task.id)
      .for('update');
    const row = rows.find((candidate) => candidate.id === entry.entityId);
    if (!row) return null;
    const archivedAt = restoredDate(prior['archivedAt']);
    const activeRows = rows.filter(
      (candidate) => candidate.archivedAt === null || candidate.id === row.id,
    );
    if (archivedAt === null) {
      planTaskReparents(activeRows, [{ taskId: row.id, parentTaskId }], false);
    }

    const metadata = Object.fromEntries(
      TRACKED.task
        .filter(
          (key) =>
            !['state', 'statusId', 'completedAt', 'canceledAt', 'autoCompletedBySubtasks'].includes(
              key,
            ),
        )
        .map((key) => [key, prior[key]]),
    );
    await tx
      .update(task)
      .set({ ...metadata, archivedAt })
      .where(and(eq(task.id, row.id), eq(task.organizationId, orgId)));
    if (archivedAt !== null) {
      return {
        mutation: null,
        cascades: await applySubtaskCompletionPolicyForParents(tx, orgId, [
          row.parentTaskId,
          parentTaskId,
        ]),
      };
    }
    const mutation = await writeTaskStateTransition(tx, {
      before: row,
      statusId,
      state,
      completedAt: restoredDate(prior['completedAt']),
      canceledAt: restoredDate(prior['canceledAt']),
      autoCompletedBySubtasks: prior['autoCompletedBySubtasks'] === true,
    });
    if (!mutation) return null;
    return {
      mutation,
      cascades: await applySubtaskCompletionPolicyForParents(tx, orgId, [
        row.parentTaskId,
        parentTaskId,
      ]),
    };
  });
  if (!result) return { ...ref, reverted: false, reason: 'gone' };
  if (result.mutation) await finishTaskStateTransition({ actorId: null }, result.mutation);
  for (const cascade of result.cascades)
    await finishTaskStateTransition({ actorId: null }, cascade);
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
export async function undoChangeSet(
  orgId: string,
  changeSetId: string,
): Promise<{ summary: string; outcomes: UndoOutcome[] }> {
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

/** Reverse one change set only when every tracked task still matches its recorded after-state. */
export async function undoChangeSetAtomically(
  orgId: string,
  changeSetId: string,
  onReverted?: (input: {
    readonly tx: Parameters<Parameters<typeof db.transaction>[0]>[0];
    readonly entries: readonly (typeof changeSetEntry.$inferSelect)[];
    readonly outcomes: readonly UndoOutcome[];
  }) => Promise<void>,
): Promise<{ summary: string; outcomes: UndoOutcome[] }> {
  const result = await serializableTx(async (tx) => {
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
    const entries = await tx
      .select()
      .from(changeSetEntry)
      .where(eq(changeSetEntry.changeSetId, changeSetId));
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
      if (!row) throw new ConflictError('Expansion can no longer be undone');
      if (entry.after && !unchangedSince(row, entry.after)) {
        throw new ConflictError('Expansion can no longer be undone');
      }
    }
    const labelEntries = entries.filter((entry) => entry.entityKind === 'task_labels');
    const labelTaskIds = [...new Set(labelEntries.map((entry) => entry.entityId))].sort();
    const labelRows =
      labelTaskIds.length === 0
        ? []
        : await tx
            .select({ taskId: taskLabel.taskId, labelId: taskLabel.labelId })
            .from(taskLabel)
            .where(
              and(eq(taskLabel.organizationId, orgId), inArray(taskLabel.taskId, labelTaskIds)),
            )
            .orderBy(taskLabel.taskId, taskLabel.labelId)
            .for('update');
    const labelsByTaskId = new Map<string, string[]>();
    for (const row of labelRows) {
      const ids = labelsByTaskId.get(row.taskId) ?? [];
      ids.push(row.labelId);
      labelsByTaskId.set(row.taskId, ids);
    }
    for (const entry of labelEntries) {
      const expected = entry.after?.['labelIds'];
      if (!Array.isArray(expected) || !expected.every((id) => typeof id === 'string')) {
        throw new ConflictError('Expansion can no longer be undone');
      }
      const current = [...(labelsByTaskId.get(entry.entityId) ?? [])].sort();
      if (
        current.length !== expected.length ||
        current.some((id, index) => id !== expected[index])
      ) {
        throw new ConflictError('Expansion can no longer be undone');
      }
    }

    const outcomes: UndoOutcome[] = [];
    const cascades: TaskStateMutation[] = [];
    for (const entry of [...entries].reverse()) {
      if (entry.entityKind === 'task') {
        const row = rowById.get(entry.entityId);
        if (!row) throw new ConflictError('Expansion can no longer be undone');
        if (entry.op === 'create') {
          await tx
            .update(task)
            .set({ archivedAt: new Date() })
            .where(and(eq(task.id, row.id), eq(task.organizationId, orgId)));
          cascades.push(
            ...(await applySubtaskCompletionPolicyForParents(tx, orgId, [row.parentTaskId])),
          );
        } else if (entry.op === 'update' && entry.before) {
          await tx
            .update(task)
            .set(taskPatchFromSnapshot(entry.before))
            .where(and(eq(task.id, row.id), eq(task.organizationId, orgId)));
        } else {
          throw new ConflictError('Expansion can no longer be undone');
        }
        outcomes.push({ kind: entry.entityKind, id: entry.entityId, reverted: true });
        continue;
      }
      if (entry.entityKind === 'task_labels') {
        const labelIds = entry.before?.['labelIds'];
        if (!Array.isArray(labelIds) || !labelIds.every((id) => typeof id === 'string')) {
          throw new ConflictError('Expansion can no longer be undone');
        }
        await tx
          .delete(taskLabel)
          .where(and(eq(taskLabel.organizationId, orgId), eq(taskLabel.taskId, entry.entityId)));
        if (labelIds.length > 0) {
          await tx.insert(taskLabel).values(
            labelIds.map((labelId) => ({
              organizationId: orgId,
              taskId: entry.entityId,
              labelId,
            })),
          );
        }
        outcomes.push({ kind: entry.entityKind, id: entry.entityId, reverted: true });
        continue;
      }
      if (!isRelation(entry.entityKind))
        throw new ConflictError('Expansion can no longer be undone');
      const edge = entry.after ?? entry.before;
      const from = edge?.['from'];
      const to = edge?.['to'];
      if (typeof from !== 'string' || typeof to !== 'string' || !entry.after) {
        throw new ConflictError('Expansion can no longer be undone');
      }
      const relation = RELATIONS[entry.entityKind];
      const table = relation.table as PgTable & { organizationId: AnyPgColumn };
      const current = await tx
        .select({ from: relation.from, to: relation.to })
        .from(table)
        .where(and(eq(relation.from, from), eq(relation.to, to), eq(table.organizationId, orgId)))
        .for('update');
      if (current.length !== 1) throw new ConflictError('Expansion can no longer be undone');
      await tx
        .delete(table)
        .where(and(eq(relation.from, from), eq(relation.to, to), eq(table.organizationId, orgId)));
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

/**
 * Where an entity came from, when a recorded change created it.
 *
 * @param kind - The entity kind.
 * @param id - The entity id.
 * @returns the origin and when it was created, or null for anything not created through a tool.
 */
export async function originOf(
  kind: string,
  id: string,
): Promise<{ origin: ChangeOrigin; at: Date; actorId: string } | null> {
  const rows = await db
    .select({ origin: changeSet.origin, at: changeSet.createdAt, actorId: changeSet.actorId })
    .from(changeSetEntry)
    .innerJoin(changeSet, eq(changeSetEntry.changeSetId, changeSet.id))
    .where(
      and(
        eq(changeSetEntry.entityKind, kind),
        eq(changeSetEntry.entityId, id),
        eq(changeSetEntry.op, 'create'),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
