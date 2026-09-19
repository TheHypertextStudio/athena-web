/**
 * `@docket/api` — returning a plan's nodes to draft after their commit is undone.
 *
 * @remarks
 * Undoing a plan commit archives the records it created. The plan document still names those
 * records on its confirmed nodes, so without this step the canvas would keep showing the undone
 * work as created. Every node whose `objectId` names a record the undo reverted goes back to
 * `draft` with no object, which puts the canvas back where it was before Confirm and lets the
 * person adjust the plan and confirm again. Nodes the commit matched rather than created are left
 * alone, because the undo never touched their records.
 */
import { db, planDraft } from '@docket/db';
import type { PlanDocument } from '@docket/work/plan-draft-contract';
import { planCounts } from '@docket/work/plan-draft';
import { eq } from 'drizzle-orm';

/** One entity an undo reports on. */
export interface RevertedEntity {
  readonly id: string;
  readonly reverted: boolean;
}

/** The document with every node naming a reverted record back in draft. */
function reopenDocument(document: PlanDocument, revertedIds: ReadonlySet<string>): PlanDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      node.objectId !== null && revertedIds.has(node.objectId)
        ? { ...node, status: 'draft', objectId: null }
        : node,
    ),
  };
}

/**
 * Put the nodes an undone commit created back into draft on their plan.
 *
 * @param planId - The plan the undone change set confirmed.
 * @param outcomes - The undo's per-entity outcomes; only reverted entities reopen.
 * @returns whether the plan changed.
 */
export async function reopenUndoneNodes(
  planId: string,
  outcomes: readonly RevertedEntity[],
): Promise<boolean> {
  const revertedIds = new Set(outcomes.filter((entry) => entry.reverted).map((entry) => entry.id));
  if (revertedIds.size === 0) return false;
  return db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(planDraft)
      .where(eq(planDraft.id, planId))
      .for('update')
      .limit(1);
    const row = locked[0];
    if (!row) return false;
    const document = reopenDocument(row.document, revertedIds);
    if (planCounts(document).draft === planCounts(row.document).draft) return false;
    await tx
      .update(planDraft)
      .set({
        document,
        status: row.status === 'archived' ? 'archived' : 'active',
        revision: row.revision + 1,
      })
      .where(eq(planDraft.id, planId));
    return true;
  });
}
