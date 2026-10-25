import {
  WorkTemplateGalleryAcceptRequest,
  type WorkTemplateCopyReceipt,
} from '@docket/work/template-gallery-contract';
import { ConflictError, NotFoundError } from '../../error';
import {
  fingerprintCopyFacts,
  type TemplateCopySourcesInput,
  type WorkTemplateSourceCopyPreview,
} from '@docket/work/template-copy';
import type { TemplateActor } from '../templates/authorization';
import type { TemplateTransaction } from '../templates/persistence';
import { serializableTx } from '../serializable-tx';
import { reconcileTemplateCreationEffects } from '../templates/creation';
import {
  getTemplateCopyBundleForRequest,
  reserveTemplateCopyBundleInTransaction,
  type TemplateCopyPrincipal,
} from '../templates/copy-reservation';
import { loadTemplateCopyActor } from '../templates/copy-reservation-context';
import { prepareGalleryCopyPreview } from './preview';
import {
  galleryAcceptanceFacts,
  galleryCopyReceipt,
  requireGalleryRetryMatches,
  type ReviewedTemplateCopy,
} from './acceptance-facts';
import { installGalleryCopy } from './install';

/**
 * Accept the exact reviewed manual catalog closure once under the verified current user principal.
 * @throws When current authoring/choices fail, the review is stale, or an existing request was changed.
 */
export async function acceptTemplateGalleryCopy(
  principal: TemplateCopyPrincipal,
  raw: WorkTemplateGalleryAcceptRequest,
): Promise<WorkTemplateCopyReceipt> {
  const body = WorkTemplateGalleryAcceptRequest.parse(raw);
  const {
    requestId: _requestId,
    expectedReviewFingerprint: _expectedReviewFingerprint,
    ...choices
  } = body;
  const choicesFingerprint = await fingerprintCopyFacts(choices);
  return acceptReviewedTemplateCopy(principal, { ...body, choicesFingerprint }, (tx, live) =>
    prepareGalleryCopyPreview(tx, live, choices),
  );
}

/** Install a reviewed source selection through the existing single reservation, writer and receipt transaction. */
export async function acceptReviewedTemplateCopy(
  principal: TemplateCopyPrincipal,
  body: {
    readonly requestId: string;
    readonly mode: WorkTemplateSourceCopyPreview['mode'];
    readonly expectedReviewFingerprint: string;
    readonly choicesFingerprint: string;
  },
  prepare: (
    tx: TemplateTransaction,
    live: TemplateActor,
  ) => Promise<{
    readonly input: TemplateCopySourcesInput;
    readonly review: ReviewedTemplateCopy;
  }>,
): Promise<WorkTemplateCopyReceipt> {
  const result = await serializableTx(async (tx) => {
    const known = await getTemplateCopyBundleForRequest(tx, principal, body.requestId);
    if (known) {
      requireGalleryRetryMatches(known, {
        ...body,
      });
      return { receipt: galleryCopyReceipt(known), effects: [] };
    }
    const live = await loadTemplateCopyActor(tx, principal);
    const prepared = await prepare(tx, live);
    if (prepared.review.reviewFingerprint !== body.expectedReviewFingerprint)
      throw new ConflictError('Review the current starting work.');
    const reserved = await reserveTemplateCopyBundleInTransaction(
      tx,
      principal,
      galleryAcceptanceFacts(
        body.requestId,
        prepared.input,
        prepared.review,
        body.choicesFingerprint,
      ),
    );
    const effects =
      reserved.kind === 'reserved'
        ? await installGalleryCopy(tx, reserved, prepared.input, prepared.review)
        : [];
    const status = await getTemplateCopyBundleForRequest(tx, principal, body.requestId);
    if (!status) throw new ConflictError('Copy outcome is unavailable');
    return { receipt: galleryCopyReceipt(status), effects };
  });
  await reconcileTemplateCreationEffects(result.effects);
  return result.receipt;
}

/** Resolve an unknown copy outcome for its active acceptor without rereading sources or requiring authoring. */
export async function reconcileTemplateGalleryCopy(
  principal: TemplateCopyPrincipal,
  requestId: string,
): Promise<WorkTemplateCopyReceipt> {
  return serializableTx(async (tx) => {
    const known = await getTemplateCopyBundleForRequest(tx, principal, requestId);
    if (!known) throw new NotFoundError('Copy outcome not found');
    return galleryCopyReceipt(known);
  });
}
