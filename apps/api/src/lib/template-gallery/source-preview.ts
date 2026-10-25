import { db } from '@docket/db';
import {
  fingerprintCopyFacts,
  previewTemplateCopySources,
  WorkTemplateSourceCopyPreview,
  WorkTemplateSourceCopyPreviewRequest,
  WorkTemplateSourceCopyAcceptRequest,
  type TemplateCopySourcesInput,
} from '@docket/work/template-copy';
import type { WorkTemplateCopyReceipt } from '@docket/work/template-gallery-contract';
import {
  installTemplateCopyContext,
  loadTemplateCopyActor,
  type TemplateCopyPrincipal,
} from '../templates/copy-reservation-context';
import type { TemplateActor } from '../templates/authorization';
import type { TemplateTransaction } from '../templates/persistence';
import { requireGalleryChoices } from './choices';
import { loadTemplateCopySources } from './source-reader';
import { acceptReviewedTemplateCopy } from './acceptance';

async function prepare(
  tx: TemplateTransaction,
  principal: TemplateCopyPrincipal,
  caller: TemplateActor,
  body: WorkTemplateSourceCopyPreviewRequest,
): Promise<{ input: TemplateCopySourcesInput; review: WorkTemplateSourceCopyPreview }> {
  await requireGalleryChoices(tx, caller, body);
  const source = await loadTemplateCopySources(
    tx,
    principal.userId,
    principal.organizationId,
    body.roots,
  );
  await installTemplateCopyContext(tx, caller);
  const input: TemplateCopySourcesInput = {
    ...source,
    labelMappings: body.labels,
    offeringChoices: body.offerings,
  };
  const checked = await previewTemplateCopySources(input);
  return {
    input,
    review: WorkTemplateSourceCopyPreview.parse({
      ...checked,
      mode: body.mode,
      reviewFingerprint: await fingerprintCopyFacts({
        mode: body.mode,
        review: checked.reviewFingerprint,
      }),
      copies: checked.copies.map((copy) => ({
        source: copy.source,
        name: copy.previewDefinition.name,
        targetType: copy.kind,
        definition: copy.previewDefinition,
        offeredTeamIds: copy.offeredTeamIds,
        dependencies: copy.dependencies,
        referenceBindings: copy.referenceBindings,
      })),
    }),
  };
}
/** Preview copies with separate source View and destination authoring checks for the actual signed-in person. */
export function previewTemplateSourceCopy(
  principal: TemplateCopyPrincipal,
  raw: WorkTemplateSourceCopyPreviewRequest,
): Promise<WorkTemplateSourceCopyPreview> {
  const body = WorkTemplateSourceCopyPreviewRequest.parse(raw);
  return db.transaction(async (tx) => {
    const prepared = await prepare(tx, principal, await loadTemplateCopyActor(tx, principal), body);
    return prepared.review;
  });
}
/** Recheck exact source facts and choices in the sole copy transaction; known outcomes never reread the source. */
export async function acceptTemplateSourceCopy(
  principal: TemplateCopyPrincipal,
  raw: WorkTemplateSourceCopyAcceptRequest,
): Promise<WorkTemplateCopyReceipt> {
  const body = WorkTemplateSourceCopyAcceptRequest.parse(raw);
  const { requestId, expectedReviewFingerprint, ...choices } = body;
  const choicesFingerprint = await fingerprintCopyFacts(choices);
  return acceptReviewedTemplateCopy(
    principal,
    { requestId, expectedReviewFingerprint, choicesFingerprint, mode: body.mode },
    (tx, caller) => prepare(tx, principal, caller, choices),
  );
}
