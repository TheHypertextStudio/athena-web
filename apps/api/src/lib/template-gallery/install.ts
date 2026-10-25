import { WorkTypeId, WorkTypeVersionId } from '@docket/work/ids';
import { WorkTemplateCreate } from '@docket/work/work-template-contract';
import {
  fingerprintCopyFacts,
  planTemplateCopySources,
  type TemplateCopySourcesInput,
} from '@docket/work/template-copy';
import { ConflictError } from '../../error';
import { catalogChange } from '../../mcp/change-set-catalog';
import { recordChangeSetInTransaction } from '../../mcp/change-set';
import { originFor } from '../provenance/context';
import {
  createWorkTemplateInTransaction,
  type TemplateCreationEffect,
} from '../templates/creation';
import {
  finishTemplateCopyBundleInTransaction,
  type TemplateCopyReservationResult,
} from '../templates/copy-reservation';
import type { TemplateTransaction } from '../templates/persistence';
import { fingerprintCopiedTemplateState } from './copy-state';
import { templateCopyEntryKey, type ReviewedTemplateCopy } from './acceptance-facts';

type Reserved = Extract<TemplateCopyReservationResult, { kind: 'reserved' }>;

/**
 * Create and optionally publish the exact checked closure through the sole canonical writer.
 * @throws When source facts, reservations, authoring, publication or aggregate receipt validation fails.
 */
export async function installGalleryCopy(
  tx: TemplateTransaction,
  reserved: Reserved,
  input: TemplateCopySourcesInput,
  review: ReviewedTemplateCopy,
): Promise<readonly TemplateCreationEffect[]> {
  const plan = await planTemplateCopySources({
    ...input,
    destinations: reserved.entries.map((entry) => ({
      kind: 'reserved',
      source: entry.sourceIdentity,
      workTypeId: WorkTypeId.parse(entry.destinationWorkTypeId),
      reservedFirstPublicationId: WorkTypeVersionId.parse(entry.reservedFirstVersionId),
    })),
  });
  if (
    (await fingerprintCopyFacts({ mode: review.mode, review: plan.reviewFingerprint })) !==
    review.reviewFingerprint
  )
    throw new ConflictError('Reviewed copy changed');
  const changes = [],
    fingerprints = [],
    effects: TemplateCreationEffect[] = [];
  for (const copy of plan.copies) {
    const capability = reserved.reservations.get(templateCopyEntryKey(copy.source));
    if (!capability) throw new ConflictError('Copy reservation is unavailable');
    const created = await createWorkTemplateInTransaction(
      tx,
      reserved.actor,
      WorkTemplateCreate.parse({
        targetType: copy.definition.payload.targetType,
        scope: 'personal',
        ownerActorId: reserved.actor.actorId,
        offeredTeamIds: copy.offeredTeamIds,
        definition: copy.definition,
      }),
      { identityReservation: capability, publish: review.mode === 'published' },
    );
    changes.push(catalogChange('template', null, created.row));
    fingerprints.push({
      key: templateCopyEntryKey(copy.source),
      fingerprint: await fingerprintCopiedTemplateState(
        created.row,
        copy.offeredTeamIds,
        review.mode === 'published' ? 'consumed' : 'pending',
      ),
    });
    effects.push(...created.effects);
  }
  const receiptId = await recordChangeSetInTransaction(tx, {
    orgId: reserved.actor.orgId,
    actorId: reserved.actor.actorId,
    origin: originFor('work_template_gallery_copy'),
    summary:
      review.mode === 'published' ? 'Added starting work definitions' : 'Kept private work drafts',
    changes,
  });
  const capability = reserved.reservations.values().next().value;
  if (!receiptId || !capability) throw new ConflictError('Copy receipt is unavailable');
  await finishTemplateCopyBundleInTransaction(tx, capability, {
    receiptId,
    afterStateFingerprints: fingerprints,
  });
  return effects;
}
