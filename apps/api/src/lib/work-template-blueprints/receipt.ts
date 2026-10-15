import { and, eq } from 'drizzle-orm';
import { changeSetEntry } from '@docket/db';
import { trackedFields } from '../../mcp/change-set';
import type { TemplateTransaction } from '../templates/persistence';
import type { InsertedWork } from '../work-creation/writers';
import { workTables } from '../work-template-selection';
import { receiptManagedDependencies } from './managed-dependencies';

/** Associate every generated root in an enclosing action with its single existing undo receipt. */
export async function rememberBlueprintReceipt(
  tx: TemplateTransaction,
  created: readonly InsertedWork[],
  changeSetId: string | null,
): Promise<void> {
  for (const work of created) {
    if (work.kind === 'milestone' || !work.row.blueprintState) continue;
    const ids = new Set([work.id]);
    for (const descendant of created)
      if (descendant.row.blueprintParentId && ids.has(descendant.row.blueprintParentId))
        ids.add(descendant.id);
    const state = {
      ...work.row.blueprintState,
      lastApplicationChangeSetId: changeSetId,
      managedDependencies: changeSetId
        ? await receiptManagedDependencies(tx, changeSetId, ids)
        : [],
    };
    const table = workTables[work.kind];
    await tx
      .update(table)
      .set({ blueprintState: state })
      .where(and(eq(table.organizationId, work.row.organizationId), eq(table.id, work.id)));
    work.row.blueprintState = state;
    if (changeSetId)
      await tx
        .update(changeSetEntry)
        .set({ after: trackedFields(work.kind, work.row) })
        .where(
          and(
            eq(changeSetEntry.changeSetId, changeSetId),
            eq(changeSetEntry.entityKind, work.kind),
            eq(changeSetEntry.entityId, work.id),
            eq(changeSetEntry.op, 'create'),
          ),
        );
  }
}
