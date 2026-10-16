import { copyIdentityKey, type TemplateCopySourcesInput } from '@docket/work/template-copy';
import {
  WorkTemplateCopyReceipt,
  type WorkTemplateGalleryPreview,
} from '@docket/work/template-gallery-contract';
import type {
  CopyBundleAcceptance,
  TemplateCopyRequestStatus,
} from '../templates/copy-reservation';
import { ConflictError } from '../../error';

/** Keep the actual catalog identity as the bounded bundle key; never use a destination or publication claim. */
function entryKey(source: WorkTemplateGalleryPreview['roots'][number]): string {
  return source.workTypeId;
}

/**
 * Freeze the complete checked dependency-first review for the transaction-owned reservation service.
 * @throws When a reviewed source is absent from the independently checked source facts.
 */
export function galleryAcceptanceFacts(
  requestId: string,
  input: TemplateCopySourcesInput,
  review: WorkTemplateGalleryPreview,
  choicesFingerprint: string,
): CopyBundleAcceptance {
  const sources = new Map(
    input.sources.map((source) => [copyIdentityKey(source.identity), source]),
  );
  return {
    requestId,
    reviewFingerprint: review.reviewFingerprint,
    choicesFingerprint,
    mode: review.mode,
    roots: review.roots.map(entryKey),
    entries: review.copies.map((copy) => {
      const checked = sources.get(copyIdentityKey(copy.source));
      if (!checked) throw new ConflictError('Reviewed source is unavailable');
      return {
        key: entryKey(copy.source),
        kind: copy.targetType,
        source: copy.source,
        sourceFingerprint: checked.fingerprint,
        dependencies: copy.dependencies.map(entryKey),
      };
    }),
  };
}

/**
 * Known outcomes must match the original choices before new source reads or destination writes.
 * @throws When the caller changed any original reviewed request choices.
 */
export function requireGalleryRetryMatches(
  status: TemplateCopyRequestStatus,
  input: {
    readonly mode: WorkTemplateGalleryPreview['mode'];
    readonly expectedReviewFingerprint: string;
    readonly choicesFingerprint: string;
  },
): void {
  if (
    status.mode !== input.mode ||
    status.reviewFingerprint !== input.expectedReviewFingerprint ||
    status.choicesFingerprint !== input.choicesFingerprint
  )
    throw new ConflictError('Copy request changed');
}

/**
 * Project the original accepted outcome without exposing source metadata or inferring a later publication.
 * @throws When an original root outcome is missing or the persisted receipt is inconsistent.
 */
export function galleryCopyReceipt(status: TemplateCopyRequestStatus): WorkTemplateCopyReceipt {
  const entries = new Map(status.entries.map((entry) => [entry.key, entry]));
  return WorkTemplateCopyReceipt.parse({
    bundleId: status.bundleId,
    changeSetId: status.receiptId,
    mode: status.mode,
    state: status.state,
    roots: status.rootEntryKeys.map((key) => {
      const entry = entries.get(key);
      if (!entry) throw new ConflictError('Copy outcome is unavailable');
      return {
        workTypeId: entry.workTypeId,
        targetType: entry.targetType,
        workTypeVersionId: status.mode === 'published' ? entry.reservedFirstVersionId : null,
      };
    }),
  });
}
