/**
 * `@docket/api` — change sets for task writes made through the REST API.
 *
 * @remarks
 * MCP tools and Athena record their own change sets, and they share the task write helpers with
 * the REST routes (`task-state`, `task-audit`). The REST routes therefore record theirs here, at
 * the route level, so no shared helper records the same change twice. Each recorder writes
 * through the route's own transaction when it has one, and records nothing when no tracked
 * field, label, or relation moved.
 *
 * A task archive is recorded as an `update` of `archivedAt`, as the MCP archive tool records it:
 * undo restores a task only from an update entry.
 */
import { db, task } from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';

import {
  recordChangeSet,
  recordChangeSetInTransaction,
  trackedFields,
  type ChangeRecord,
  type LinkRecord,
  type RecordedChange,
  type StoredChange,
} from '../../mcp/change-set';
import { labelSetChange } from '../../mcp/change-set-labels';
import { labelsForSubject, replaceLabels, type ResolvedLabel } from '../labels';
import {
  applySubtaskCompletionPolicyForParents,
  type TaskRow,
  type TaskStateMutation,
} from '../task-state';
import { originFor } from './context';

/** An open database transaction. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A change that may have turned out empty. */
type MaybeChange = RecordedChange | null;

/** A comparable form of one tracked value: dates compare by instant. */
function comparable(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value;
}

/** Whether two tracked snapshots hold the same values. */
function sameSnapshot(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return Object.keys(a).every((key) => comparable(a[key]) === comparable(b[key]));
}

/**
 * The create entry for a new task.
 *
 * @param row - The inserted task row.
 * @returns the change to record.
 */
export function taskCreateChange(row: TaskRow): ChangeRecord {
  return { kind: 'task', id: row.id, op: 'create', after: trackedFields('task', row) };
}

/**
 * The update entry for one task row change.
 *
 * @param mutation - The row before and after the write.
 * @returns the change to record, or null when no tracked field moved.
 */
export function taskUpdateChange(mutation: TaskStateMutation): ChangeRecord | null {
  const before = trackedFields('task', mutation.before);
  const after = trackedFields('task', mutation.after);
  if (sameSnapshot(before, after)) return null;
  return { kind: 'task', id: mutation.after.id, op: 'update', before, after };
}

/**
 * The link entry for a related-task edge, under the edge's canonical endpoint order.
 *
 * @param taskId - One endpoint.
 * @param relatedTaskId - The other endpoint.
 * @param linked - true when the edge was added, false when it was removed.
 * @returns the change to record.
 */
export function relatedTaskLink(
  taskId: string,
  relatedTaskId: string,
  linked: boolean,
): LinkRecord {
  const [from, to] = taskId < relatedTaskId ? [taskId, relatedTaskId] : [relatedTaskId, taskId];
  return { kind: 'related_task', from, to, linked };
}

/**
 * The label-set entry for a task.
 *
 * @param taskId - The task.
 * @param before - Label ids before the write.
 * @param after - Label ids after the write.
 * @returns the change to record, or null when the set did not change.
 */
export function taskLabelsChange(
  taskId: string,
  before: readonly string[],
  after: readonly string[],
): StoredChange | null {
  const sortedBefore = [...before].sort();
  const sortedAfter = [...after].sort();
  const unchanged =
    sortedBefore.length === sortedAfter.length &&
    sortedBefore.every((id, index) => id === sortedAfter[index]);
  return unchanged ? null : labelSetChange('task', taskId, sortedBefore, sortedAfter);
}

/** Input to {@link recordTaskChangeSet}. */
export interface TaskChangeSetInput {
  readonly orgId: string;
  readonly actorId: string;
  /** The operation name recorded as `origin.tool`. */
  readonly tool: string;
  readonly summary: string;
  /** The changes; null entries are changes that turned out empty and are dropped. */
  readonly changes: readonly MaybeChange[];
}

/**
 * Record a task change set through the caller's transaction.
 *
 * @param tx - The transaction that made the writes.
 * @param input - The org, acting actor, operation, summary, and changes.
 * @returns the change-set id, or null when nothing changed.
 * @throws {MissingProvenanceError} When a change is recorded outside any provenance scope.
 */
export async function recordTaskChangeSet(
  tx: Tx,
  input: TaskChangeSetInput,
): Promise<string | null> {
  const changes = input.changes.filter((change): change is RecordedChange => change !== null);
  if (changes.length === 0) return null;
  return recordChangeSetInTransaction(tx, {
    orgId: input.orgId,
    actorId: input.actorId,
    origin: originFor(input.tool),
    summary: input.summary,
    changes,
  });
}

/** A task write and the parent completions it caused. */
export interface SettledTaskWrite {
  readonly row: TaskRow;
  readonly cascades: TaskStateMutation[];
}

/** Input to {@link settleTaskCreation}. */
export interface TaskCreationInput {
  readonly orgId: string;
  readonly actorId: string;
  /** The operation name recorded as `origin.tool`; `create_task` when omitted. */
  readonly tool?: string;
  /** The inserted task. */
  readonly row: TaskRow;
  /** Tasks the new task was related to on creation. */
  readonly relatedTaskIds?: readonly string[];
  /** Labels attached on creation. */
  readonly labels: readonly ResolvedLabel[];
}

/**
 * Apply the parent's completion policy to a new task and record the creation.
 *
 * @param tx - The transaction that inserted the task.
 * @param input - The new task and what was attached to it.
 * @returns the task and the parent completions it caused.
 */
export async function settleTaskCreation(
  tx: Tx,
  input: TaskCreationInput,
): Promise<SettledTaskWrite> {
  const { row } = input;
  const cascades = await applySubtaskCompletionPolicyForParents(tx, input.orgId, [
    row.parentTaskId,
  ]);
  await recordTaskChangeSet(tx, {
    orgId: input.orgId,
    actorId: input.actorId,
    tool: input.tool ?? 'create_task',
    summary: `Created "${row.title}"`,
    changes: [
      taskCreateChange(row),
      ...(input.relatedTaskIds ?? []).map((relatedId) => relatedTaskLink(row.id, relatedId, true)),
      taskLabelsChange(
        row.id,
        [],
        input.labels.map((attached) => attached.id),
      ),
      ...cascades.map(taskUpdateChange),
    ],
  });
  return { row, cascades };
}

/** Input to {@link settleTaskArchive}. */
export interface TaskArchiveInput {
  readonly orgId: string;
  readonly actorId: string;
  /** The task as the archive left it; it was active before. */
  readonly row: TaskRow;
}

/**
 * Apply the parent's completion policy to an archived task and record the archive.
 *
 * @param tx - The transaction that archived the task.
 * @param input - The archived task.
 * @returns the task and the parent completions it caused.
 */
export async function settleTaskArchive(
  tx: Tx,
  input: TaskArchiveInput,
): Promise<SettledTaskWrite> {
  const { row } = input;
  const cascades = await applySubtaskCompletionPolicyForParents(tx, input.orgId, [
    row.parentTaskId,
  ]);
  await recordTaskChangeSet(tx, {
    orgId: input.orgId,
    actorId: input.actorId,
    tool: 'archive_task',
    summary: `Archived "${row.title}"`,
    changes: [
      taskUpdateChange({ before: { ...row, archivedAt: null }, after: row }),
      ...cascades.map(taskUpdateChange),
    ],
  });
  return { row, cascades };
}

/**
 * Replace a task's labels and describe the change.
 *
 * @param tx - The open transaction.
 * @param orgId - The task's organization.
 * @param taskId - The task.
 * @param labels - The new label set, or undefined to leave labels alone.
 * @returns the label-set change, or null when nothing was replaced or the set is unchanged.
 */
export async function replaceTaskLabelSet(
  tx: Tx,
  orgId: string,
  taskId: string,
  labels: readonly ResolvedLabel[] | undefined,
): Promise<StoredChange | null> {
  if (labels === undefined) return null;
  const current = await labelsForSubject('task', orgId, taskId, tx);
  await replaceLabels(tx, 'task', taskId, orgId, labels);
  return taskLabelsChange(
    taskId,
    current.map((attached) => attached.id),
    labels.map((attached) => attached.id),
  );
}

/** A related-task edge a write added or removed. */
export interface RelatedTaskEdgeChange {
  /** The other endpoint. */
  readonly taskId: string;
  readonly linked: boolean;
}

/** Input to {@link recordTaskPatch}. */
export interface TaskPatchRecord {
  readonly orgId: string;
  readonly actorId: string;
  readonly before: TaskRow;
  readonly after: TaskRow;
  readonly cascades: readonly TaskStateMutation[];
  readonly related: readonly RelatedTaskEdgeChange[];
  readonly labels: StoredChange | null;
}

/**
 * Record a task edit: its fields, labels, related tasks, and the parent completions it caused.
 *
 * @param tx - The transaction that made the edit.
 * @param input - The task before and after, and what else moved.
 * @returns the change-set id, or null when nothing tracked changed.
 */
export async function recordTaskPatch(tx: Tx, input: TaskPatchRecord): Promise<string | null> {
  return recordTaskChangeSet(tx, {
    orgId: input.orgId,
    actorId: input.actorId,
    tool: 'update_task',
    summary: `Updated "${input.after.title}"`,
    changes: [
      taskUpdateChange(input),
      input.labels,
      ...input.related.map((edge) => relatedTaskLink(input.after.id, edge.taskId, edge.linked)),
      ...input.cascades.map(taskUpdateChange),
    ],
  });
}

/** Input to {@link recordTaskStateChange}. */
export interface TaskStateChangeRecord {
  readonly orgId: string;
  readonly actorId: string;
  readonly mutation: TaskStateMutation;
  readonly cascades: readonly TaskStateMutation[];
}

/**
 * Record a workflow-state change and the parent completions it caused.
 *
 * @param tx - The transaction that made the change.
 * @param input - The state mutation and its cascades.
 * @returns the change-set id, or null when nothing tracked changed.
 */
export async function recordTaskStateChange(
  tx: Tx,
  input: TaskStateChangeRecord,
): Promise<string | null> {
  return recordTaskChangeSet(tx, {
    orgId: input.orgId,
    actorId: input.actorId,
    tool: 'set_task_state',
    summary: `Moved "${input.mutation.after.title}" to ${input.mutation.after.state}`,
    changes: [input.mutation, ...input.cascades].map(taskUpdateChange),
  });
}

/** Input to {@link recordTaskDependency}. */
export interface TaskDependencyRecord {
  readonly orgId: string;
  readonly actorId: string;
  readonly blockingTaskId: string;
  readonly blockedTaskId: string;
  /** true when the dependency was added, false when it was removed. */
  readonly linked: boolean;
}

/**
 * Record one dependency edge being added or removed.
 *
 * @param tx - The transaction that wrote the edge.
 * @param input - The edge and its direction of change.
 * @returns the change-set id.
 */
export async function recordTaskDependency(
  tx: Tx,
  input: TaskDependencyRecord,
): Promise<string | null> {
  return recordTaskChangeSet(tx, {
    orgId: input.orgId,
    actorId: input.actorId,
    tool: input.linked ? 'add_dependency' : 'remove_dependency',
    summary: input.linked ? 'Added a dependency' : 'Removed a dependency',
    changes: [
      {
        kind: 'blocks',
        from: input.blockingTaskId,
        to: input.blockedTaskId,
        linked: input.linked,
      },
    ],
  });
}

/** One committed hierarchy move. */
export interface CommittedTaskMove {
  readonly taskId: string;
  readonly previousParentTaskId: string | null;
  readonly parentTaskId: string | null;
}

/**
 * Record a committed batch of hierarchy moves.
 *
 * @remarks
 * The reparent service commits its own transaction, so this records after it from the moved
 * rows. Each entry differs from its row only in `parentTaskId`, which is all a move changes.
 *
 * @param orgId - The organization.
 * @param actorId - The acting actor.
 * @param moves - The moves the service committed.
 * @returns the change-set id, or null when nothing moved.
 */
export async function recordTaskReparents(
  orgId: string,
  actorId: string,
  moves: readonly CommittedTaskMove[],
): Promise<string | null> {
  if (moves.length === 0) return null;
  const rows = await db
    .select()
    .from(task)
    .where(
      and(
        eq(task.organizationId, orgId),
        inArray(
          task.id,
          moves.map((move) => move.taskId),
        ),
      ),
    );
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const changes = moves.map((move) => {
    const row = rowById.get(move.taskId);
    if (!row) return null;
    return taskUpdateChange({
      before: { ...row, parentTaskId: move.previousParentTaskId },
      after: { ...row, parentTaskId: move.parentTaskId },
    });
  });
  const recorded = changes.filter((change): change is ChangeRecord => change !== null);
  if (recorded.length === 0) return null;
  return recordChangeSet({
    orgId,
    actorId,
    origin: originFor('reparent_tasks'),
    summary: recorded.length === 1 ? 'Moved 1 task' : `Moved ${String(recorded.length)} tasks`,
    changes: recorded,
  });
}
