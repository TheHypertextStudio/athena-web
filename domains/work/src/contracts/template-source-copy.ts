import { z } from 'zod';
import { OrganizationId, TeamId } from '@docket/identity-access/ids';
import { LabelId, WorkTypeId, WorkTypeVersionId } from '../ids';
import { CopySourceIdentity } from '../gallery/copy-identity';
import { StepKey } from './work-template-blueprint';
import { WorkTemplateGalleryPreview, WorkTemplateGalleryPreviewCopy } from './template-gallery';

/** Human-selected origin; latest is resolved once per checked preview, never accepted as authority. */
export const WorkTemplateCopySourceSelection = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('catalog'),
    slug: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/)
      .max(100),
    release: z.literal(1),
  }),
  z.strictObject({
    kind: z.literal('draft'),
    organizationId: OrganizationId,
    workTypeId: WorkTypeId,
  }),
  z.strictObject({
    kind: z.literal('publication'),
    organizationId: OrganizationId,
    workTypeId: WorkTypeId,
    selection: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('latest') }),
      z.strictObject({ kind: z.literal('pinned'), workTypeVersionId: WorkTypeVersionId }),
    ]),
  }),
]);
/** Source selection without any caller-owned executor, recipient or destination identity. */
export type WorkTemplateCopySourceSelection = z.infer<typeof WorkTemplateCopySourceSelection>;
/** Explicit destination decisions; unmapped source-local values are omitted in the review. */
export const WorkTemplateSourceCopyPreviewRequest = z.strictObject({
  roots: z.array(WorkTemplateCopySourceSelection).min(1).max(100),
  mode: z.enum(['private_drafts', 'published']),
  labels: z
    .array(
      z.strictObject({
        sourceOrganizationId: OrganizationId,
        sourceLabelId: LabelId,
        destinationLabelId: LabelId,
      }),
    )
    .max(100)
    .default([]),
  offerings: z
    .array(z.strictObject({ source: CopySourceIdentity, teamIds: z.array(TeamId).max(100) }))
    .max(100)
    .default([]),
});
/** Validated manual copy choices; the service resolves both workspaces from the signed-in person. */
export type WorkTemplateSourceCopyPreviewRequest = z.infer<
  typeof WorkTemplateSourceCopyPreviewRequest
>;
/** Authorized union-source review; catalog-only consumers retain their existing narrower contract. */
export const WorkTemplateSourceCopyPreview = WorkTemplateGalleryPreview.extend({
  roots: z.array(CopySourceIdentity).min(1).max(100),
  copies: z
    .array(
      WorkTemplateGalleryPreviewCopy.extend({
        source: CopySourceIdentity,
        dependencies: z.array(CopySourceIdentity).max(100),
        referenceBindings: z
          .array(
            z.strictObject({
              slot: z.strictObject({
                kind: z.enum(['blueprint_step', 'default_schedule']),
                key: StepKey,
              }),
              target: CopySourceIdentity,
            }),
          )
          .max(2000),
      }),
    )
    .min(1)
    .max(100),
  omissions: z.array(
    WorkTemplateGalleryPreview.shape.omissions.element.extend({ source: CopySourceIdentity }),
  ),
});
/** Complete source-authorized semantic review before any destination allocation. */
export type WorkTemplateSourceCopyPreview = z.infer<typeof WorkTemplateSourceCopyPreview>;
/** Accept the exact review under an acceptor-owned retry identity, with publication always explicit. */
export const WorkTemplateSourceCopyAcceptRequest = WorkTemplateSourceCopyPreviewRequest.extend({
  requestId: z.uuid(),
  expectedReviewFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
/** Validated union-source acceptance choices, never a trusted source snapshot. */
export type WorkTemplateSourceCopyAcceptRequest = z.infer<
  typeof WorkTemplateSourceCopyAcceptRequest
>;
