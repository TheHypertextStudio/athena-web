import { deferAfterResponse } from '../after-response';
import { eq } from 'drizzle-orm';
import type { TemplateTargetType } from '@docket/work/template-contract';
import type { DeferredWorkEffect } from '../work-creation/types';
import type {
  WorkTemplateIdentity,
  WorkTemplateAssignment,
} from '@docket/work/work-template-reference';
import type { ActorCtx } from '../../context';
import { ApiError, ConflictError, ValidationError } from '../../error';
import { recordChangeSetInTransaction, trackedFields } from '../../mcp/change-set';
import type { TemplateTransaction } from '../templates/persistence';
import { workTables } from '../work-template-selection';
import { workTemplateIdentityOut } from '../work-template-creation';
import { labelsForSubject } from '../labels';
import { labelSetChange } from '../../mcp/change-set-labels';
import { originFor } from '../provenance/context';
import { updateSelectiveRoot } from './selective-root-write';
import { settleCreationParents } from '../work-creation/service';
import { deferWorkCreationEffects } from '../work-creation/effects';
import { prepareSelectiveReview, type PreparedSelectiveReview } from './selective-review';
import { prepareSelectiveTree } from './selective-prepare';
import { authorizeSelectiveWrites, writeSelectiveExisting } from './selective-writes';
import { prepareSelectiveEdges, writeSelectiveEdges } from './selective-edges';
import { applyPreparedBlueprintCreation } from './apply';
import { readBlueprintWork } from './snapshot-rows';
import { selectiveReceiptChanges } from './selective-receipt';

/** Committed identity and deferred ordinary/workflow effects from one selective action. */
export interface SelectiveAssignmentResult {
  readonly identity: WorkTemplateIdentity;
  readonly effects: readonly DeferredWorkEffect[];
  readonly afterCommit: readonly (() => Promise<void>)[];
}

function validateChoices(
  review: PreparedSelectiveReview,
  selection: WorkTemplateAssignment,
): Set<string> {
  if (selection.previewToken && selection.previewToken !== review.preview.previewToken)
    throw new ConflictError('Review the current template changes.', 'blueprint_preview_stale');
  const fields = selection.applyFields ?? [],
    accepted = new Set(selection.acceptChildChanges ?? []);
  if ((fields.length || accepted.size) && !selection.previewToken)
    throw new ValidationError([
      { path: ['previewToken'], message: 'Review changes before applying them.' },
    ]);
  if (
    fields.some((field) => !review.preview.changes.some((change) => change.field === field)) ||
    [...accepted].some((id) => !review.differences.some((change) => change.changeId === id))
  )
    throw new ValidationError([
      { path: ['acceptChildChanges'], message: 'Choose only changes in this preview.' },
    ]);
  return accepted;
}
async function loadReviewedAssignment(
  tx: TemplateTransaction,
  caller: ActorCtx,
  kind: TemplateTargetType,
  { id, selection }: { id: string; selection: WorkTemplateAssignment },
) {
  return await prepareSelectiveReview(tx, caller, kind, id, selection).catch((error: unknown) => {
    if (
      selection.previewToken &&
      error instanceof ApiError &&
      [400, 403, 404].includes(error.status)
    )
      throw new ConflictError('Review the current template changes.', 'blueprint_preview_stale');
    throw error;
  });
}

/** Apply one reviewed selective action with one transaction-owned existing undo receipt. */
export async function applySelectiveAssignment(
  tx: TemplateTransaction,
  caller: ActorCtx,
  kind: TemplateTargetType,
  input: { id: string; selection: WorkTemplateAssignment },
): Promise<SelectiveAssignmentResult> {
  const { id, selection } = input;
  const review = await loadReviewedAssignment(tx, caller, kind, input);
  const accepted = validateChoices(review, selection);
  await authorizeSelectiveWrites(tx, review, accepted);
  const tree = await prepareSelectiveTree(tx, review, accepted, selection.applyFields);
  const edges = await prepareSelectiveEdges(tx, review, tree, accepted);
  const beforeLabels = selection.applyFields?.includes('labels')
    ? await labelsForSubject(kind, caller.orgId, id, tx)
    : null;
  const inserted = await applyPreparedBlueprintCreation(tx, tree);
  const existing = await writeSelectiveExisting(
    tx,
    review,
    review.differences.filter((change) => accepted.has(change.changeId)),
  );
  const edgeChanges = await writeSelectiveEdges(tx, caller.orgId, edges);
  const starting = await updateSelectiveRoot(tx, review, selection, {
    owned: edges.owned,
    manifest: tree.tree.manifest,
    optionalChoices: tree.command.blueprint?.optionalChoices ?? [],
  });
  const settled = await settleCreationParents(tx, caller.orgId, [
    ...inserted.parentTaskIds,
    ...existing.parentTaskIds,
  ]);
  const after = await readBlueprintWork(tx, caller.orgId, { kind, id });
  const before = review.snapshot.rowsByRef.get(`${kind}:${id}`);
  if (!before || after.kind === 'milestone') throw new ConflictError('Reviewed root changed.');
  const changes = selectiveReceiptChanges([
    ...inserted.changes,
    ...existing.changes,
    ...edgeChanges,
    ...starting.changes,
    ...settled.changes,
    ...(beforeLabels && review.starting
      ? [
          labelSetChange(
            kind,
            id,
            beforeLabels.map((label) => label.id),
            review.starting.labels.map((label) => label.id),
          ),
        ]
      : []),
    {
      kind,
      id,
      op: 'update',
      before: trackedFields(kind, before.row),
      after: trackedFields(kind, after.row),
    },
  ]);
  const receipt = await recordChangeSetInTransaction(tx, {
    orgId: caller.orgId,
    actorId: caller.actorId,
    origin: originFor('work_template_assignment'),
    summary: review.preview.mode === 'update' ? 'Updated template' : 'Changed template',
    changes,
  });
  if (!after.row.blueprintState) throw new ConflictError('Reviewed root state changed.');
  await tx
    .update(workTables[kind])
    .set({ blueprintState: { ...after.row.blueprintState, lastApplicationChangeSetId: receipt } })
    .where(eq(workTables[kind].id, id));
  return {
    identity: workTemplateIdentityOut(after.row),
    effects: [...inserted.effects, ...existing.effects, ...settled.effects],
    afterCommit: [...existing.afterCommit, ...(starting.effect ? [starting.effect] : [])],
  };
}
/** Drain all committed selective work through existing projection and workflow effects. */
export function finishSelectiveAssignment(
  result: Awaited<ReturnType<typeof applySelectiveAssignment>>,
): void {
  deferWorkCreationEffects(result.effects);
  for (const effect of result.afterCommit) {
    // Callers schedule this after commit; callback failures cannot roll back or invite duplicate writes.
    deferAfterResponse('work-template-assignment-effect', effect);
  }
}
