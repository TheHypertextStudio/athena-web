import { z } from 'zod';

import { WorkTypeId, WorkTypeVersionId } from '../ids';
import { EntityDisplayGlyph } from './entity-display';

/** Optional creation identity; omitted fields select the workspace's base template. */
export const workTemplateCreationFields = {
  workTypeId: WorkTypeId.optional(),
  workTypeVersionId: WorkTypeVersionId.optional(),
};

/** Refuse a version whose definition has not been supplied alongside it. */
export function validateWorkTemplateSelection(
  selection: { workTypeId?: string | undefined; workTypeVersionId?: string | undefined },
  context: z.RefinementCtx,
): void {
  if (selection.workTypeVersionId !== undefined && selection.workTypeId === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['workTypeVersionId'],
      message: 'Choose the template together with its published version.',
    });
  }
}

/** A creation selection, independent of the starting-draft contract's kind imports. */
export const WorkTemplateSelection = z
  .object(workTemplateCreationFields)
  .superRefine(validateWorkTemplateSelection);
/** Work-template creation selection value. */
export type WorkTemplateSelection = z.infer<typeof WorkTemplateSelection>;

/** Why a work item acquired its current template association. */
export const WorkTemplateAssignmentSource = z.enum([
  'created',
  'migration_baseline',
  'changed',
  'updated',
]);
/** Work-template assignment provenance value. */
export type WorkTemplateAssignmentSource = z.infer<typeof WorkTemplateAssignmentSource>;

/** Complete identity required on current server work projections. */
export const WorkTemplateIdentity = z.object({
  workTypeId: WorkTypeId,
  workTypeVersionId: WorkTypeVersionId,
  workTypeAssignedAt: z.iso.datetime(),
  workTypeAssignmentSource: WorkTemplateAssignmentSource,
});
/** Complete current work-template association value. */
export type WorkTemplateIdentity = z.infer<typeof WorkTemplateIdentity>;

/** Small published display projection; it carries no draft body or private authoring state. */
export const WorkTemplateDisplay = z.object({
  id: WorkTypeId,
  name: z.string().min(1),
  icon: EntityDisplayGlyph.nullable(),
  isBase: z.boolean(),
  archived: z.boolean(),
  versionNumber: z.number().int().positive(),
  latestVersionNumber: z.number().int().positive(),
});
/** Published work-template display value. */
export type WorkTemplateDisplay = z.infer<typeof WorkTemplateDisplay>;

/** Legacy caches may lack identity; current server serializers require WorkTemplateIdentity. */
export const workTemplateOutputFields = {
  ...WorkTemplateIdentity.partial().shape,
  workTemplate: WorkTemplateDisplay.optional(),
};

/** A published header choice, carrying only identity and bounded display metadata. */
export const WorkTemplateChoice = WorkTemplateDisplay.extend({ versionId: WorkTypeVersionId });
/** Published header choice value. */
export type WorkTemplateChoice = z.infer<typeof WorkTemplateChoice>;

/** Starting values a person may explicitly adopt when changing an existing item's template. */
export const WorkTemplateChangeField = z.enum([
  'title',
  'name',
  'summary',
  'description',
  'priority',
  'health',
  'status',
  'labels',
  'visibility',
  'updateCadence',
]);
/** A supported starting-field choice; authored dates and child work are deliberately excluded. */
export type WorkTemplateChangeField = z.infer<typeof WorkTemplateChangeField>;

const previewToken = z.string().regex(/^sha256:[a-f0-9]{64}$/);

/** Select one publication to preview without accepting any starting changes. */
export const WorkTemplateChangeRequest = z.strictObject({
  workTypeId: WorkTypeId,
  workTypeVersionId: WorkTypeVersionId.optional(),
});
/** A published template selected for a resource-authorized change preview. */
export type WorkTemplateChangeRequest = z.infer<typeof WorkTemplateChangeRequest>;

/** One optional difference between existing work and its selected published starting values. */
export const WorkTemplateFieldChange = z.strictObject({
  field: WorkTemplateChangeField,
  label: z.string(),
  before: z.union([z.string(), z.array(z.string()), z.null()]),
  after: z.union([z.string(), z.array(z.string()), z.null()]),
});
/** An optional, default-off starting-field difference. */
export type WorkTemplateFieldChange = z.infer<typeof WorkTemplateFieldChange>;

/** Bounded publication-specific differences, with a token that refuses a changed work snapshot. */
export const WorkTemplateChangePreview = z.strictObject({
  workTypeId: WorkTypeId,
  workTypeVersionId: WorkTypeVersionId,
  previewToken,
  changes: z.array(WorkTemplateFieldChange).max(10),
});
/** Authorized differences for exactly one item and selected publication. */
export type WorkTemplateChangePreview = z.infer<typeof WorkTemplateChangePreview>;

/** Assign identity and only explicitly chosen, previewed starting values; defaults preserve work. */
export const WorkTemplateAssignment = WorkTemplateChangeRequest.extend({
  previewToken: previewToken.optional(),
  applyFields: z.array(WorkTemplateChangeField).max(10).default([]),
}).superRefine((selection, context) => {
  if (new Set(selection.applyFields).size !== selection.applyFields.length) {
    context.addIssue({
      code: 'custom',
      path: ['applyFields'],
      message: 'Choose each change once.',
    });
  }
  if (selection.applyFields.length > 0 && selection.previewToken === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['previewToken'],
      message: 'Review changes before applying starting values.',
    });
  }
});
/** Reviewed reassignment input; omitted choices retain the existing identity-only behavior. */
export type WorkTemplateAssignment = Omit<z.infer<typeof WorkTemplateAssignment>, 'applyFields'> & {
  readonly applyFields?: WorkTemplateChangeField[] | undefined;
};
