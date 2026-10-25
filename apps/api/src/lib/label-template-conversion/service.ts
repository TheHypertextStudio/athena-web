import { createHash } from 'node:crypto';
import { changeSet, changeSetEntry } from '@docket/db';
import { TemplateTargetType } from '@docket/work/template-contract';
import { and, eq } from 'drizzle-orm';
import {
  LabelTemplateConversionChoices,
  LabelTemplateConversionConfirm,
  LabelTemplateConversionReceipt,
} from '@docket/work/work-template-contract';
import { serializableTx } from '../serializable-tx';
import {
  prepareLabelTemplateConversion,
  conversionFingerprint,
  requireConversionReviewer,
  type ConversionReviewer,
} from './review';
import type { TemplateTransaction } from '../templates/persistence';
import { ConflictError, NotFoundError } from '../../error';
import { recordChangeSetInTx, type StoredChange } from '../../mcp/change-set';
import { labelSetChange } from '../../mcp/change-set-labels';
import { writePreparedTemplateIdentityOnly } from '../work-template-blueprints/selective-identity';
import { replaceLabels, resolveAttachedLabels } from '../labels';
import { originFor } from '../provenance/context';
import { deferAfterResponse } from '../after-response';
import { enqueueSearchUpsert } from '../../search/write-through';
import { resolveResourceAccess, resourceAccessKey } from '../../permissions/resource-access';

/** A private opaque receipt id binds one reviewed command to one active workspace actor. */
function receiptId(caller: ConversionReviewer, requestId: string): string {
  return `label_conversion_${createHash('sha256')
    .update(JSON.stringify([caller.orgId, caller.actorId, requestId]))
    .digest('hex')}`;
}
async function knownReceipt(
  tx: TemplateTransaction,
  caller: ConversionReviewer,
  id: string,
  fingerprint?: string,
) {
  await requireConversionReviewer(tx, caller);
  const [receipt] = await tx
    .select()
    .from(changeSet)
    .where(
      and(
        eq(changeSet.id, id),
        eq(changeSet.organizationId, caller.orgId),
        eq(changeSet.actorId, caller.actorId),
      ),
    )
    .limit(1);
  if (!receipt) return null;
  if (
    receipt.origin.tool !== 'label_template_conversion' ||
    (fingerprint && receipt.origin.ref?.commandFingerprint !== fingerprint)
  )
    throw new ConflictError('This request already has different choices.');
  const entries = await tx
    .select({ kind: changeSetEntry.entityKind, id: changeSetEntry.entityId })
    .from(changeSetEntry)
    .where(eq(changeSetEntry.changeSetId, id));
  const work = entries.flatMap((entry) => {
    const kind = TemplateTargetType.safeParse(entry.kind);
    return kind.success ? [{ organizationId: caller.orgId, kind: kind.data, id: entry.id }] : [];
  });
  const access = await resolveResourceAccess(caller.userId, work, tx);
  if (work.some((ref) => !access.get(resourceAccessKey(ref))?.canView)) throw new NotFoundError();
  return LabelTemplateConversionReceipt.parse({
    changeSetId: id,
    state: receipt.undoneAt ? 'undone' : 'converted',
    itemCount: work.length,
  });
}
/** Preview an explicitly bounded batch without modifying definitions, labels or work. */
export function previewLabelTemplateConversion(caller: ConversionReviewer, raw: unknown) {
  const choices = LabelTemplateConversionChoices.parse(raw);
  return serializableTx(
    async (tx) => (await prepareLabelTemplateConversion(tx, caller, choices)).review,
  );
}
/** Reconcile an interrupted response without rerunning source reads or requiring current write rights. */
export function reconcileLabelTemplateConversion(caller: ConversionReviewer, requestId: string) {
  return serializableTx(async (tx) => {
    const receipt = await knownReceipt(tx, caller, receiptId(caller, requestId));
    if (!receipt) throw new NotFoundError();
    return receipt;
  });
}
/** Confirm exactly the reviewed identity and selected label removals in one existing aggregate receipt. */
export async function confirmLabelTemplateConversion(caller: ConversionReviewer, raw: unknown) {
  const request = LabelTemplateConversionConfirm.parse(raw);
  const { requestId: _requestId, expectedReviewFingerprint: _expected, ...choices } = request;
  const id = receiptId(caller, request.requestId),
    fingerprint = conversionFingerprint(request);
  const result = await serializableTx(async (tx) => {
    const known = await knownReceipt(tx, caller, id, fingerprint);
    if (known) return { receipt: known, affected: [] };
    const checked = await prepareLabelTemplateConversion(tx, caller, choices);
    if (checked.review.reviewFingerprint !== request.expectedReviewFingerprint)
      throw new ConflictError('Review the current work and labels before confirming.');
    const changes: StoredChange[] = [];
    for (const { item, identity, currentLabels } of checked.prepared) {
      const applied = await writePreparedTemplateIdentityOnly(tx, identity);
      const remaining = currentLabels.filter(
        (label) => !item.removeLabelIds.some((id) => id === label.id),
      );
      const resolved = await resolveAttachedLabels(
        caller.orgId,
        remaining.map((label) => label.id),
        tx,
      );
      await replaceLabels(tx, item.kind, item.id, caller.orgId, resolved);
      changes.push(
        applied.change,
        labelSetChange(
          item.kind,
          item.id,
          currentLabels.map((label) => label.id),
          remaining.map((label) => label.id),
        ),
      );
    }
    await recordChangeSetInTx(tx, {
      id,
      orgId: caller.orgId,
      actorId: caller.actorId,
      origin: originFor('label_template_conversion', {
        ref: { commandId: request.requestId, commandFingerprint: fingerprint },
      }),
      summary: 'Changed work templates and removed selected type labels',
      changes,
    });
    await tx
      .update(changeSet)
      .set({ templateReviewActorId: caller.actorId })
      .where(eq(changeSet.id, id));
    return {
      receipt: LabelTemplateConversionReceipt.parse({
        changeSetId: id,
        state: 'converted',
        itemCount: checked.prepared.length,
      }),
      affected: checked.prepared.map(({ item }) => ({ kind: item.kind, id: item.id })),
    };
  });
  for (const item of result.affected)
    deferAfterResponse('label-template-conversion-search', () =>
      enqueueSearchUpsert(caller.orgId, item.kind, item.id),
    );
  return result.receipt;
}
