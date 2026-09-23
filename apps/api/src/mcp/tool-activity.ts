/**
 * `@docket/api` — the task activity an MCP tool's writes produce.
 *
 * @remarks
 * A task's activity feed reads `audit_event` rows. The REST routes write those rows beside every
 * field, dependency, and label change; the MCP tools record change sets instead, so their edits
 * reached a task's provenance but never its feed. This writes the same rows the REST path writes,
 * from the change set a tool records, and each row takes its origin from the tool call's
 * provenance scope — which is how the feed names Claude Code or Athena rather than the person.
 *
 * Creates are left out: the feed builds a task's creation from the task itself. State changes are
 * left out by the callers that already record them through `finishTaskStateTransition`.
 */
import { db, task } from '@docket/db';
import type { TaskActivityChange } from '@docket/connections/activity-contract';
import { and, eq, inArray } from 'drizzle-orm';

import { insertAuditEvents } from '../lib/provenance/audit-events';
import {
  diffTaskFields,
  recordTaskChanges,
  resolveTaskChangeLabels,
  taskActivityRows,
} from '../lib/task-audit';
import type { TaskRow } from '../routes/task-helpers';
import {
  recordChangeSet,
  type ChangeRecord,
  type LinkRecord,
  type RecordChangeSetInput,
  type RecordedChange,
} from './change-set';

/** A `blocks` edge a tool linked or unlinked. */
type BlocksRecord = LinkRecord & { readonly kind: 'blocks' };

/** A tracked update to one task. */
type TaskUpdateRecord = ChangeRecord & { readonly kind: 'task'; readonly op: 'update' };

/** Whether a recorded change links or unlinks two tasks with `blocks`. */
function isBlocks(change: RecordedChange): change is BlocksRecord {
  return change.kind === 'blocks' && 'linked' in change;
}

/** Whether a recorded change updates one task's tracked fields. */
function isTaskUpdate(change: RecordedChange): change is TaskUpdateRecord {
  return change.kind === 'task' && 'op' in change && change.op === 'update';
}

/**
 * Read a tracked snapshot as the task row the field diff compares.
 *
 * @remarks
 * `diffTaskFields` reads only the audited columns, and the change set tracks every one of them
 * (`TRACKED.task` in `change-set.ts`), so the snapshot carries all the diff needs.
 */
function snapshotRow(snapshot: Record<string, unknown> | undefined): TaskRow {
  return (snapshot ?? {}) as TaskRow;
}

/** The current title of every task named, for the feed line. */
async function titlesOf(orgId: string, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: task.id, title: task.title })
    .from(task)
    .where(and(eq(task.organizationId, orgId), inArray(task.id, [...new Set(ids)])));
  return new Map(rows.map((row) => [row.id, row.title]));
}

/**
 * Write field-change rows for a task's tracked update, as the REST PATCH route writes them.
 *
 * @param orgId - The organization.
 * @param actorId - The member the change ran as.
 * @param before - The task as it was.
 * @param after - The task as it is now.
 * @param extra - Changes the field diff cannot see, such as a label set.
 */
export async function recordTaskFieldActivity(
  orgId: string,
  actorId: string,
  before: TaskRow,
  after: TaskRow,
  extra: readonly TaskActivityChange[] = [],
): Promise<void> {
  const changes = [
    ...(await resolveTaskChangeLabels(orgId, diffTaskFields(before, after))),
    ...extra,
  ];
  await recordTaskChanges({
    organizationId: orgId,
    taskId: after.id,
    title: after.title,
    actorId,
    changes,
  });
}

/** A label set's names before and after a tool replaced it, each joined for display. */
export interface LabelFieldChange {
  readonly from: string;
  readonly to: string;
}

/** The patch fields the activity depends on. */
interface UpdateSetting {
  readonly state?: unknown;
}

/** The member an update runs as. */
interface ActingMember {
  readonly actorId: string;
}

/** What the `update` tool knows about the call a row was written in. */
export interface UpdateRowScope {
  readonly entity: string;
  readonly orgId: string;
  readonly set: UpdateSetting;
  readonly actorCtx: ActingMember;
}

/** The label change a row took. */
export interface RowLabelChange {
  readonly field: LabelFieldChange;
}

/**
 * Write the task activity for one row the `update` tool wrote.
 *
 * @remarks
 * A state change already wrote every field that moved with it through
 * `finishTaskStateTransition`, so only its label change is written here. Other entities have no
 * activity feed.
 *
 * @param scope - The call the row was written in.
 * @param before - The row as it was.
 * @param after - The row as it is now.
 * @param labels - The label change the row took, when it took one.
 */
export async function recordUpdatedRowActivity(
  scope: UpdateRowScope,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  labels: RowLabelChange | null,
): Promise<void> {
  if (scope.entity !== 'task') return;
  const { orgId } = scope;
  const { actorId } = scope.actorCtx;
  const labelChanges = labels ? labelActivity(labels.field) : [];
  const task = after as TaskRow;
  if (scope.set.state === undefined) {
    await recordTaskFieldActivity(orgId, actorId, before as TaskRow, task, labelChanges);
    return;
  }
  await recordTaskChanges({
    organizationId: orgId,
    taskId: task.id,
    title: task.title,
    actorId,
    changes: labelChanges,
  });
}

/** The activity entry for a label set a tool replaced; `''` stands for no labels. */
function labelActivity(labels: LabelFieldChange): TaskActivityChange[] {
  return [{ field: 'labels', label: 'Labels', from: labels.from || null, to: labels.to || null }];
}

/** Write both endpoints' dependency rows for each `blocks` edge, as the REST routes word them. */
async function recordBlocksActivity(
  orgId: string,
  actorId: string,
  edges: readonly BlocksRecord[],
): Promise<void> {
  if (edges.length === 0) return;
  const titles = await titlesOf(
    orgId,
    edges.flatMap((edge) => [edge.from, edge.to]),
  );
  const rows = edges.flatMap((edge) => {
    const blocking = titles.get(edge.from) ?? edge.from;
    const blocked = titles.get(edge.to) ?? edge.to;
    const entry = (taskId: string, title: string, text: string) =>
      taskActivityRows({
        organizationId: orgId,
        taskId,
        title,
        actorId,
        changes: [
          {
            field: 'dependency',
            label: 'Dependency',
            from: edge.linked ? null : text,
            to: edge.linked ? text : null,
          },
        ],
      });
    return [
      ...entry(edge.from, blocking, `Blocks ${blocked}`),
      ...entry(edge.to, blocked, `Blocked by ${blocking}`),
    ];
  });
  await insertAuditEvents(db, 'link', rows);
}

/**
 * Write the task activity a tool's recorded changes imply.
 *
 * @param orgId - The organization.
 * @param actorId - The member the change ran as.
 * @param changes - The changes the tool recorded.
 */
export async function recordToolActivity(
  orgId: string,
  actorId: string,
  changes: readonly RecordedChange[],
): Promise<void> {
  for (const change of changes.filter(isTaskUpdate)) {
    await recordTaskFieldActivity(orgId, actorId, snapshotRow(change.before), {
      ...snapshotRow(change.after),
      id: change.id,
    });
  }
  await recordBlocksActivity(orgId, actorId, changes.filter(isBlocks));
}

/**
 * Record a tool's change set, then the task activity it implies.
 *
 * @param input - The change set to record.
 * @returns the change set id, or null when nothing was touched.
 */
export async function recordToolChangeSet(
  input: Omit<RecordChangeSetInput, 'id' | 'recordEmpty'>,
): Promise<string | null> {
  const id = await recordChangeSet(input);
  await recordToolActivity(input.orgId, input.actorId, input.changes);
  return id;
}
