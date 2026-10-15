import { ActorId, OrganizationId, TeamId } from '@docket/identity-access/ids';
import { z } from 'zod';

import { WorkTypeId, WorkTypeVersionId } from '../ids';
import { EntityDisplayGlyph } from './entity-display';
import { ViewScope } from './saved-view';
import { TemplateDraft, TemplateTargetType } from './template';

const offeredTeamIds = z.array(TeamId).refine((ids) => new Set(ids).size === ids.length, {
  message: 'Offer a template to each team only once.',
});

/** The editable definition copied unchanged into each publication. */
export const WorkTemplateDefinition = z.strictObject({
  name: z
    .string()
    .min(1)
    .refine((name) => name.trim().length > 0, 'Name the template.'),
  description: z.string().nullable().default(null),
  icon: EntityDisplayGlyph.nullable().default(null),
  defaultStatusKey: z.string().min(1).nullable().default(null),
  payload: TemplateDraft,
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
  revision: z.number().int().nonnegative(),
  definition: WorkTemplateDefinition,
  draftDefinition: WorkTemplateDefinition.optional(),
  offeredTeamIds,
  latestVersion: WorkTemplateVersionOut.nullable(),
  canEdit: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
/** Authorized work-template definition projection value. */
export type WorkTemplateOut = z.infer<typeof WorkTemplateOut>;

/** Definition discovery within one kind and optional creation team. */
export const WorkTemplateListQuery = z.object({
  targetType: TemplateTargetType.optional(),
  teamId: TeamId.optional(),
  includeDrafts: z.enum(['true', 'false']).optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
});
/** Work-template discovery query value. */
export type WorkTemplateListQuery = z.infer<typeof WorkTemplateListQuery>;
