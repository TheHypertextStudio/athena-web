import { ActorId, OrganizationId, TeamId } from '@docket/identity-access/ids';
import { z } from 'zod';

import { WorkTypeId, WorkTypeVersionId } from '../ids';
import { EntityDisplayGlyph } from './entity-display';
import { ViewScope } from './saved-view';
import { Blueprint, BlueprintPreviewWarning, WorkTemplateOrigin } from './work-template-blueprint';
import { CanonicalTemplateDraft, TemplateTargetType } from './template';
import { ProgramDefaultSchedules } from './work-schedule-defaults';

const offeredTeamIds = z.array(TeamId).refine((ids) => new Set(ids).size === ids.length, {
  message: 'Offer a template to each team only once.',
});

/** The editable definition copied unchanged into each publication. */
export const WorkTemplateDefinition = z
  .strictObject({
    name: z
      .string()
      .min(1)
      .refine((name) => name.trim().length > 0, 'Name the template.'),
    description: z.string().nullable().default(null),
    icon: EntityDisplayGlyph.nullable().default(null),
    defaultStatusKey: z.string().min(1).nullable().default(null),
    payload: CanonicalTemplateDraft,
    blueprint: Blueprint.default({ steps: [], dependencies: [] }),
    defaultSchedules: ProgramDefaultSchedules.default([]),
  })
  .superRefine((definition, context) => {
    if (definition.payload.targetType !== 'program' && definition.defaultSchedules.length)
      context.addIssue({
        code: 'custom',
        path: ['defaultSchedules'],
        message: 'Only Program templates have default schedules.',
      });
  });
/** Editable or published work-template definition value. */
export type WorkTemplateDefinition = z.infer<typeof WorkTemplateDefinition>;

/** Create an unpublished definition; clients cannot supply publication or base flags. */
export const WorkTemplateCreate = z
  .strictObject({
    targetType: TemplateTargetType,
    scope: ViewScope.default('personal'),
    ownerActorId: ActorId.optional(),
    teamId: TeamId.optional(),
    offeredTeamIds: offeredTeamIds.default([]),
    definition: WorkTemplateDefinition,
  })
  .superRefine((input, context) => {
    if (input.definition.payload.targetType !== input.targetType) {
      context.addIssue({
        code: 'custom',
        path: ['definition', 'payload'],
        message: 'The starting draft must match the template kind.',
      });
    }
    if (input.scope === 'team' && input.teamId === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['teamId'],
        message: 'Choose the team that may read this draft.',
      });
    }
    if (input.scope !== 'team' && input.teamId !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['teamId'],
        message: 'Only a team draft has a private team.',
      });
    }
  });
/** New unpublished work-template input value. */
export type WorkTemplateCreate = z.infer<typeof WorkTemplateCreate>;

/** Revision-aware draft edit; publication remains an explicit separate operation. */
export const WorkTemplateDraftUpdate = z
  .strictObject({
    expectedRevision: z.number().int().nonnegative(),
    definition: WorkTemplateDefinition.optional(),
    offeredTeamIds: offeredTeamIds.optional(),
  })
  .refine((input) => input.definition !== undefined || input.offeredTeamIds !== undefined, {
    message: 'Change the definition or the teams where it is offered.',
  });
/** Revision-aware work-template draft edit value. */
export type WorkTemplateDraftUpdate = z.infer<typeof WorkTemplateDraftUpdate>;

/** Publish precisely the draft revision the caller reviewed. */
export const WorkTemplatePublish = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
});
/** Work-template publication request value. */
export type WorkTemplatePublish = z.infer<typeof WorkTemplatePublish>;

/** Publication lifecycle independent of the legacy draft's visibility. */
export const WorkTemplateState = z.enum(['draft', 'published', 'archived']);
/** Work-template publication lifecycle value. */
export type WorkTemplateState = z.infer<typeof WorkTemplateState>;

/** Workspace-controlled authoring policy; contributors are the default. */
export const WorkTemplateAuthoringPolicy = z.enum(['contributors', 'admins']);
/** Workspace work-template authoring policy value. */
export type WorkTemplateAuthoringPolicy = z.infer<typeof WorkTemplateAuthoringPolicy>;

/** One immutable publication of a workspace's work template. */
export const WorkTemplateVersionOut = z.object({
  id: WorkTypeVersionId,
  workTypeId: WorkTypeId,
  organizationId: OrganizationId,
  number: z.number().int().positive(),
  definition: WorkTemplateDefinition,
  publishedAt: z.iso.datetime(),
  publishedByActorId: ActorId.nullable(),
});
/** Published work-template version projection value. */
export type WorkTemplateVersionOut = z.infer<typeof WorkTemplateVersionOut>;

/** Authorized definition projection; draftDefinition is omitted for publication-only readers. */
export const WorkTemplateOut = z.object({
  id: WorkTypeId,
  organizationId: OrganizationId,
  targetType: TemplateTargetType,
  status: WorkTemplateState,
  scope: ViewScope,
  ownerActorId: ActorId.nullable(),
  teamId: TeamId.nullable(),
  isBase: z.boolean(),
  origin: WorkTemplateOrigin.nullable().default(null),
  revision: z.number().int().nonnegative(),
  definition: WorkTemplateDefinition,
  draftDefinition: WorkTemplateDefinition.optional(),
  offeredTeamIds,
  latestVersion: WorkTemplateVersionOut.nullable(),
  /** Actual visible first-publication reservation; it is not an existing immutable version. */
  pendingPublication: z.strictObject({ reservedFirstVersionId: WorkTypeVersionId }).optional(),
  canEdit: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
/** Authorized work-template definition projection value. */
export type WorkTemplateOut = z.infer<typeof WorkTemplateOut>;

/** Authorized independent inline capture for review before creating a private draft. */
export const WorkTemplateCapturePreview = z.strictObject({
  sourceSnapshotToken: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  definition: WorkTemplateDefinition,
  origin: WorkTemplateOrigin.nullable(),
  warnings: z.array(BlueprintPreviewWarning).max(100),
  descendantCount: z.number().int().min(0).max(499),
});
/** Reviewed capture of a complete authorized current work tree. */
export type WorkTemplateCapturePreview = z.infer<typeof WorkTemplateCapturePreview>;

/** Name an independent private draft after reviewing the exact source snapshot and warnings. */
export const WorkTemplateCaptureRequest = z.strictObject({
  name: WorkTemplateDefinition.shape.name,
  sourceSnapshotToken: WorkTemplateCapturePreview.shape.sourceSnapshotToken,
});
/** Save-as request; publication and source edits are never implied. */
export type WorkTemplateCaptureRequest = z.infer<typeof WorkTemplateCaptureRequest>;

/** The newly created author-only draft and the warnings reviewed with its capture. */
export const WorkTemplateCaptureResult = z.strictObject({
  template: WorkTemplateOut,
  warnings: z.array(BlueprintPreviewWarning).max(100),
});
/** Independent personal template ready for its existing sample editor. */
export type WorkTemplateCaptureResult = z.infer<typeof WorkTemplateCaptureResult>;

/** Definition discovery within one kind and optional creation team. */
export const WorkTemplateListQuery = z.object({
  targetType: TemplateTargetType.optional(),
  teamId: TeamId.optional(),
  includeDrafts: z.enum(['true', 'false']).optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
});
/** Work-template discovery query value. */
export type WorkTemplateListQuery = z.infer<typeof WorkTemplateListQuery>;

/** Bounded independent pages of authorized archive references. */
export const WorkTemplateArchiveImpactQuery = z.strictObject({
  parentOffset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  scheduleOffset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
/** Archive impact pagination input. */
export type WorkTemplateArchiveImpactQuery = z.infer<typeof WorkTemplateArchiveImpactQuery>;
const archiveImpactPage = z.strictObject({
  items: z.array(z.strictObject({ id: z.string().min(1), name: z.string().min(1) })).max(50),
  total: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
});
/** Authorized current references; no private invocation or concrete work content. */
export const WorkTemplateArchiveImpact = z.strictObject({
  parents: archiveImpactPage,
  schedules: archiveImpactPage,
});
/** Authorized template archive impact projection. */
export type WorkTemplateArchiveImpact = z.infer<typeof WorkTemplateArchiveImpact>;

/** Recipient-private exact template review and canonical editor continuation. */
export const TemplateProposalReview = z.strictObject({
  activityId: z.string(),
  sessionId: z.string(),
  proposerName: z.string(),
  state: z.enum(['pending', 'kept', 'dismissed', 'undone']),
  revision: z.number().int().nonnegative(),
  definition: WorkTemplateDefinition,
  templateId: z.string().nullable(),
  templateRevision: z.number().int().nonnegative().nullable(),
  publicationState: z.enum(['draft', 'published', 'archived']).nullable(),
  hasReceipt: z.boolean(),
  visibility: z.literal('personal'),
  labelConversion: z
    .strictObject({
      labelGroupId: z.ulid(),
      labelId: z.ulid(),
      workTypeId: z.ulid(),
      workTypeVersionId: z.ulid(),
    })
    .optional(),
});
/** Authorized review projection. */
export type TemplateProposalReview = z.infer<typeof TemplateProposalReview>;
/** A decision is bound to both the proposal and the editable draft the person actually reviewed. */
export const TemplateProposalDecision = z.strictObject({
  action: z.enum(['keep', 'adjust', 'dismiss', 'undo']),
  expectedRevision: z.number().int().nonnegative(),
  expectedTemplateRevision: z.number().int().nonnegative().nullable(),
});

export {
  LabelTemplateConversionChoices,
  LabelTemplateConversionReview,
  LabelTemplateConversionConfirm,
  LabelTemplateConversionReceipt,
} from './work-template-label-conversion';
