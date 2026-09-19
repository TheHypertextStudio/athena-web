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
import { and, eq } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';

/** The entity kinds a change set can record, mapped to the table they live in. */
export const RECORDABLE = { task, project, program, initiative } as const;

/** One recordable entity kind. */
export type RecordableKind = keyof typeof RECORDABLE;

/** The columns every recordable row exposes to change-set reads and reversals. */
export type RecordableTable = PgTable & {
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
export const RELATIONS = {
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
export function isRelation(kind: string): kind is RelationKind {
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
export const TRACKED: Record<RecordableKind, readonly string[]> = {
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
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
