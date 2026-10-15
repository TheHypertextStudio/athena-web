import { initiative, program, project, task } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { FieldDiff } from './catalog-rows';
import { trackedFields, type RecordedChange, type Tx } from './change-set';
import type { RowContext } from './update-row-contract';
import { diff } from './update-display';
import { applyLabelEdit, type RowLabelResult } from './update-labels';
import { applyInitiativeEdit } from './update-relations';
import { recordUpdatedRowActivity } from './tool-activity';
import { enqueueSearchUpsert } from '../search/write-through';
import { taskUpdateChange } from '../lib/provenance/task-change-sets';
import {
  applySubtaskCompletionPolicy,
  closeCompletingUserTaskTimers,
  emitCompletedTaskTimerStops,
  finishTaskStateTransition,
  writeTaskStateTransition,
} from '../lib/task-state';
const TABLES = { task, project, program, initiative } as const;
/** Effects are returned to the bulk transaction owner and drained only after commit. */
export interface UpdatedColumns {
  readonly after: Record<string, unknown>;
  readonly cascades: readonly RecordedChange[];
  readonly finish?: () => Promise<void>;
}
async function writeTaskState(
  tx: Tx,
  rc: RowContext,
  id: string,
  patch: Record<string, unknown>,
): Promise<UpdatedColumns | null> {
  const { statusId, state, completedAt, canceledAt, ...remainingPatch } = patch;
  const where = and(eq(task.id, id), eq(task.organizationId, rc.orgId));
  const [current] = await tx.select().from(task).where(where).for('update').limit(1);
  if (!current) return null;
  const mutation = await writeTaskStateTransition(tx, {
    before: current,
    statusId: String(statusId),
    state: String(state),
    completedAt: completedAt as Date | null,
    canceledAt: canceledAt as Date | null,
  });
  if (!mutation) return null;
  const timerStops = await closeCompletingUserTaskTimers(tx, rc.actorCtx.actorId, mutation);
  const [after] =
    Object.keys(remainingPatch).length === 0
      ? [mutation.after]
      : await tx.update(task).set(remainingPatch).where(where).returning();
  if (!after) return null;
  const finalMutation = { before: current, after };
  const cascades = await applySubtaskCompletionPolicy(tx, finalMutation);
  return {
    after,
    cascades: cascades.flatMap((cascade) => {
      const change = taskUpdateChange(cascade);
      return change ? [change] : [];
    }),
    finish: async () => {
      await finishTaskStateTransition({ actorId: rc.actorCtx.actorId }, finalMutation);
      await emitCompletedTaskTimerStops(timerStops);
      for (const cascade of cascades) await finishTaskStateTransition({ actorId: null }, cascade);
    },
  };
}
async function writeColumns(
  tx: Tx,
  rc: RowContext,
  row: Record<string, unknown>,
  patch: Record<string, unknown>,
): Promise<UpdatedColumns | null> {
  const id = String(row['id']);
  if (rc.entity === 'task' && rc.set.state !== undefined) return writeTaskState(tx, rc, id, patch);
  if (Object.keys(patch).length === 0) return { after: row, cascades: [] };
  const table = TABLES[rc.entity] as PgTable & {
    id: typeof task.id;
    organizationId: typeof task.organizationId;
  };
  const [after] = await tx
    .update(table)
    .set(patch)
    .where(and(eq(table.id, id), eq(table.organizationId, rc.orgId)))
    .returning();
  return after ? { after, cascades: [] } : null;
}
/** Edit a row's label set and initiative membership, adding each diff line and recorded change. */
async function applyEdgeEdits(
  rc: RowContext,
  id: string,
  report: { fields: FieldDiff[]; changes: RecordedChange[] },
  database: Tx,
): Promise<RowLabelResult | null> {
  const { entity, orgId } = rc;
  const labels = rc.labelEdit
    ? await applyLabelEdit(entity, orgId, id, rc.labelEdit, database)
    : null;
  if (labels) {
    report.fields.push(labels.field);
    report.changes.push(labels.change);
  }
  const member = entity === 'project' || entity === 'program' ? entity : null;
  const initiatives =
    member && rc.initiativeEdit
      ? await applyInitiativeEdit(
          { member, orgId, subjectId: id, edit: rc.initiativeEdit, actorId: rc.actorCtx.actorId },
          database,
        )
      : null;
  if (initiatives) {
    report.fields.push(initiatives.field);
    report.changes.push(...initiatives.changes);
  }
  return labels;
}

/** One ordinary row result with deferred activity, timer and search effects. */
export interface WrittenUpdateRow {
  readonly next: Record<string, unknown>;
  readonly fields: FieldDiff[];
  readonly changes: RecordedChange[];
  readonly finish: () => Promise<void>;
}
/** Write one permitted row inside its enclosing bulk transaction without emitting effects. */
export async function writeUpdateRow(
  tx: Tx,
  rc: RowContext,
  row: Record<string, unknown>,
  patch: Record<string, unknown>,
): Promise<WrittenUpdateRow | null> {
  const written = await writeColumns(tx, rc, row, patch);
  if (!written) return null;
  const before = trackedFields(rc.entity, row),
    after = trackedFields(rc.entity, written.after);
  const fields = diff(before, after);
  const changes: RecordedChange[] = [...written.cascades];
  if (JSON.stringify(before) !== JSON.stringify(after))
    changes.push({ kind: rc.entity, id: String(row['id']), op: 'update', before, after });
  const labels = await applyEdgeEdits(rc, String(row['id']), { fields, changes }, tx);
  return {
    next: written.after,
    fields,
    changes,
    finish: async () => {
      await written.finish?.();
      await recordUpdatedRowActivity(rc, row, written.after, labels);
      if (changes.length) await enqueueSearchUpsert(rc.orgId, rc.entity, String(row['id']));
    },
  };
}
