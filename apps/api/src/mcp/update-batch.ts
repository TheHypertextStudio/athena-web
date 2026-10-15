import { initiative, program, project, task } from '@docket/db';
import { BlueprintError } from '@docket/work/blueprints';
import { BlueprintDateBindings } from '@docket/work/work-template-blueprint';
import { and, eq } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { CapabilityError } from '../error';
import { serializableTx } from '../lib/serializable-tx';
import { loadCreationActor } from '../lib/work-creation/context';
import { originFor } from '../lib/provenance/context';
import { explicitBlueprintDatePatch } from '../lib/work-template-blueprints/date-ownership';
import {
  prepareBlueprintReflow,
  applyBlueprintReflow,
  finishBlueprintReflow,
  type PreparedBlueprintReflow,
} from '../lib/work-template-blueprints/reflow';
import { entityHref } from './entity-href';
import { addRetainedManualPinField, titleOf } from './update-display';
import { writeUpdateRow } from './update-row-writes';
import type { RowContext, RowReport, RowSkip } from './update-row-contract';
import { recordChangeSetInTransaction, type RecordedChange, type Tx } from './change-set';

/** A whole-row refusal or an ordinary authorized patch, before writes begin. */
export type UpdateRowPatch =
  | { readonly skipped: RowSkip }
  | {
      readonly patch: Record<string, unknown>;
    };
/** One locked initiating row with its authorized dependent snapshot. */
interface PreparedUpdateRow {
  readonly row: Record<string, unknown>;
  readonly patch: Record<string, unknown>;
  readonly reflow: PreparedBlueprintReflow | null;
}
/** Reversible bulk result; effects have completed only after the transaction commits. */
export interface UpdateBatchResult {
  readonly report: RowReport[];
  readonly skipped: RowSkip[];
  readonly changes: RecordedChange[];
  readonly changeSetId: string | null;
}
type PrepareRow = (rc: RowContext, row: Record<string, unknown>, tx: Tx) => Promise<UpdateRowPatch>;
const TABLES = { task, project, program, initiative } as const;

async function prepareRows(
  tx: Tx,
  rc: RowContext,
  rows: readonly Record<string, unknown>[],
  prepare: PrepareRow,
): Promise<{ readonly rows: PreparedUpdateRow[]; readonly skipped: RowSkip[] }> {
  const actor = await loadCreationActor(tx, rc.orgId, rc.actorCtx.actorId);
  const prepared: PreparedUpdateRow[] = [],
    skipped: RowSkip[] = [];
  const affected = new Set<string>();
  const table = TABLES[rc.entity] as PgTable & {
    id: typeof task.id;
    organizationId: typeof task.organizationId;
  };
  for (const selected of [...rows].sort((a, b) => String(a['id']).localeCompare(String(b['id'])))) {
    const [row] = await tx
      .select()
      .from(table)
      .where(and(eq(table.id, String(selected['id'])), eq(table.organizationId, rc.orgId)))
      .for('update')
      .limit(1);
    if (!row) continue;
    const choice = await prepare(rc, row, tx);
    if ('skipped' in choice) {
      skipped.push(choice.skipped);
      continue;
    }
    const reflow = await prepareBlueprintReflow(
      tx,
      actor,
      {
        kind: rc.entity,
        id: String(row['id']),
      },
      rc.set,
    );
    if (reflow) for (const id of reflow.affectedWorkIds) affected.add(id);
    if (affected.size > 500)
      throw new BlueprintError('blueprint_limit', 'Reflow at most 500 affected descendants.');
    prepared.push({
      row,
      reflow,
      patch: {
        ...choice.patch,
        ...explicitBlueprintDatePatch(
          {
            blueprintDateBindings: BlueprintDateBindings.parse(row['blueprintDateBindings'] ?? {}),
          },
          rc.set,
        ),
      },
    });
  }
  return { rows: prepared, skipped };
}

/** Preserve the first before and final after when several accepted anchors touch the same row. */
export function aggregateUpdateChanges(changes: readonly RecordedChange[]): RecordedChange[] {
  const entries = new Map<string, RecordedChange>();
  for (const change of changes) {
    const key =
      'linked' in change
        ? `${change.kind}:${change.from}:${change.to}`
        : `${change.kind}:${change.id}`;
    const previous = entries.get(key);
    if (
      previous &&
      !('linked' in previous) &&
      !('linked' in change) &&
      previous.op === 'update' &&
      change.op === 'update'
    )
      entries.set(key, {
        kind: change.kind,
        id: change.id,
        op: 'update',
        before: previous.before ?? null,
        after: change.after ?? null,
      });
    else entries.set(key, change);
  }
  return [...entries.values()];
}

async function writePreparedRow(tx: Tx, rc: RowContext, item: PreparedUpdateRow) {
  try {
    return rc.initiativeEdit
      ? await tx.transaction((savepoint) => writeUpdateRow(savepoint, rc, item.row, item.patch))
      : await writeUpdateRow(tx, rc, item.row, item.patch);
  } catch (error) {
    if (!(error instanceof CapabilityError)) throw error;
    return {
      skipped: {
        id: String(item.row['id']),
        title: titleOf(item.row, ''),
        reason: 'not_permitted',
      },
    };
  }
}

async function writeBatch(
  tx: Tx,
  rc: RowContext,
  prepared: Awaited<ReturnType<typeof prepareRows>>,
) {
  const report: RowReport[] = [],
    skipped = [...prepared.skipped];
  const changes: RecordedChange[] = [],
    finish: (() => Promise<void>)[] = [];
  const accepted: PreparedUpdateRow[] = [];
  for (const item of prepared.rows) {
    const written = await writePreparedRow(tx, rc, item);
    if (!written) continue;
    if ('skipped' in written) {
      skipped.push(written.skipped);
      continue;
    }
    const id = String(item.row['id']);
    report.push({
      id,
      title: titleOf(written.next, id),
      href: entityHref(rc.orgId, rc.entity, id),
      fields: written.fields,
    });
    changes.push(...written.changes);
    finish.push(written.finish);
    accepted.push(item);
  }
  const cascadeIds = changes.flatMap((change) =>
    'id' in change && change.kind === 'task' ? [change.id] : [],
  );
  for (const item of accepted) {
    const derived = await applyBlueprintReflow(tx, item.reflow, cascadeIds);
    const initiating = report.find((entry) => entry.id === String(item.row['id']));
    if (initiating)
      addRetainedManualPinField(initiating.fields, derived.changes, rc.entity, initiating.id);
    changes.push(...derived.changes);
    finish.push(() => finishBlueprintReflow(rc.orgId, derived));
  }
  return { report, skipped, changes: aggregateUpdateChanges(changes), finish };
}

/** Commit direct edits, all derived dates, and their aggregate undo receipt as one operation. */
export async function executeUpdateBatch(
  rc: RowContext,
  rows: readonly Record<string, unknown>[],
  prepare: PrepareRow,
): Promise<UpdateBatchResult> {
  const result = await serializableTx(async (tx) => {
    const prepared = await prepareRows(tx, rc, rows, prepare);
    const written = await writeBatch(tx, rc, prepared);
    const changed = written.report.filter((row) => row.fields.length);
    const changeSetId = await recordChangeSetInTransaction(tx, {
      orgId: rc.orgId,
      actorId: rc.actorCtx.actorId,
      origin: originFor('update'),
      summary:
        changed.length === 1 && changed[0]
          ? `Updated "${changed[0].title}"`
          : `Updated ${changed.length} ${rc.entity}s`,
      changes: written.changes,
    });
    return { ...written, changeSetId };
  });
  for (const finish of result.finish) await finish();
  return result;
}
