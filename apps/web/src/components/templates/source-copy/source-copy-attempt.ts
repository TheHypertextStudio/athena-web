import {
  WorkTemplateSourceCopyAcceptRequest,
  WorkTemplateSourceCopyPreviewRequest,
} from '@docket/work/template-copy';
import {
  templateCopyAttempt,
  type GalleryAttempt,
  type GalleryAttemptScope,
} from '../gallery/gallery-acceptance-attempt';

/** Check saved-source choices and retain the ordinary canonical acceptance identity, never definition bodies. */
export function sourceCopyAttempt(
  scope: GalleryAttemptScope,
  input: WorkTemplateSourceCopyPreviewRequest,
  preview: {
    readonly reviewFingerprint: string;
    readonly mode: WorkTemplateSourceCopyPreviewRequest['mode'];
  },
): Promise<GalleryAttempt<WorkTemplateSourceCopyAcceptRequest>> {
  return templateCopyAttempt(
    scope,
    WorkTemplateSourceCopyPreviewRequest.parse(input),
    preview,
    (request, requestId, fingerprint) =>
      WorkTemplateSourceCopyAcceptRequest.parse({
        ...request,
        requestId,
        expectedReviewFingerprint: fingerprint,
      }),
  );
}
