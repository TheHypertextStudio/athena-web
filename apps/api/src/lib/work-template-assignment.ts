import type { TemplateTargetType } from '@docket/work/template-contract';
import type {
  WorkTemplateAssignment,
  WorkTemplateIdentity,
  WorkTemplateChangeRequest,
  WorkTemplateChangePreview,
} from '@docket/work/work-template-reference';
import type { ActorCtx } from '../context';
import { serializableTx } from './serializable-tx';
import { prepareSelectiveReview } from './work-template-blueprints/selective-review';
import {
  applySelectiveAssignment,
  finishSelectiveAssignment,
} from './work-template-blueprints/selective-accept';
import { assignTemplateIdentityOnly } from './work-template-blueprints/selective-identity';

/** Load a bounded authorized review of one exact publication and its optional work changes. */
export async function previewWorkTemplateAssignment(
  caller: ActorCtx,
  kind: TemplateTargetType,
  id: string,
  selection: WorkTemplateChangeRequest,
): Promise<WorkTemplateChangePreview> {
  return serializableTx(
    async (tx) => (await prepareSelectiveReview(tx, caller, kind, id, selection)).preview,
  );
}

/**
 * Apply one explicitly reviewed template change with one existing transaction and undo receipt.
 * @throws For unavailable work, live authorization failures, stale review or unreviewed changes.
 */
export async function assignWorkTemplate(
  caller: ActorCtx,
  kind: TemplateTargetType,
  id: string,
  selection: WorkTemplateAssignment,
): Promise<WorkTemplateIdentity> {
  if (
    !selection.previewToken &&
    !selection.applyFields?.length &&
    !selection.acceptChildChanges?.length &&
    (selection.mode ?? 'change') === 'change'
  )
    return serializableTx((tx) => assignTemplateIdentityOnly(tx, caller, kind, { id, selection }));
  const result = await serializableTx((tx) =>
    applySelectiveAssignment(tx, caller, kind, { id, selection }),
  );
  finishSelectiveAssignment(result);
  return result.identity;
}
