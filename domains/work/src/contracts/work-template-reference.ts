import { z } from 'zod';

import { WorkTypeId, WorkTypeVersionId } from '../ids';
import { EntityDisplayGlyph } from './entity-display';
import {
  BlueprintCreationOptions,
  BlueprintCivilDate,
  BlueprintDateRule,
  BlueprintPreviewSummary,
  BlueprintPreviewWarning,
  StepKey,
} from './work-template-blueprint';

/** Optional creation identity; omitted fields select the workspace's base template. */
export const workTemplateCreationFields = {
  blueprint: BlueprintCreationOptions.optional(),
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
  mode: z.enum(['change', 'update']).default('change'),
});
/** A published template selected for a resource-authorized change preview. */
export type WorkTemplateChangeRequest = Omit<z.infer<typeof WorkTemplateChangeRequest>, 'mode'> & {
  readonly mode?: 'change' | 'update';
};

/** One optional difference between existing work and its selected published starting values. */
export const WorkTemplateFieldChange = z.strictObject({
  field: WorkTemplateChangeField,
  label: z.string(),
  before: z.union([z.string(), z.array(z.string()), z.null()]),
  after: z.union([z.string(), z.array(z.string()), z.null()]),
});
/** An optional, default-off starting-field difference. */
export type WorkTemplateFieldChange = z.infer<typeof WorkTemplateFieldChange>;

/** Opaque display-choice identity; never a concrete work ID or a client write payload. */
export const WorkTemplateChildChangeId = z.string().regex(/^bp_[a-f0-9]{16}$/);
/** Opaque reviewed child-change identity. */
export type WorkTemplateChildChangeId = z.infer<typeof WorkTemplateChildChangeId>;
const childPath = z.array(StepKey).max(499);
const childChange = { changeId: WorkTemplateChildChangeId, selectedByDefault: z.boolean() };
/** Bounded independently selectable child differences, omitting private bodies and insert values. */
export const WorkTemplateChildChange = z.discriminatedUnion('kind', [
  z.strictObject({
    ...childChange,
    kind: z.literal('add_child'),
    path: childPath,
    count: z.number().int().positive().max(499),
    children: z.array(BlueprintPreviewSummary).min(1).max(499),
  }),
  z.strictObject({
    ...childChange,
    kind: z.literal('set_derived_date'),
    path: childPath,
    title: z.string().max(256),
    field: z.enum(['startDate', 'dueDate', 'targetDate']),
    previous: BlueprintCivilDate.nullable(),
    value: BlueprintCivilDate.nullable(),
    rule: BlueprintDateRule,
    selectedByDefault: z.literal(false),
  }),
  z.strictObject({
    ...childChange,
    kind: z.enum(['add_dependency', 'remove_dependency']),
    blockerPath: childPath,
    blockedPath: childPath,
    blockerTitle: z.string().max(256),
    blockedTitle: z.string().max(256),
    selectedByDefault: z.literal(false),
  }),
  z.strictObject({
    ...childChange,
    kind: z.literal('cancel_removed_child'),
    path: childPath,
    title: z.string().max(256),
    selectedByDefault: z.literal(false),
  }),
]);
/** Authorized child difference display value. */
export type WorkTemplateChildChange = z.infer<typeof WorkTemplateChildChange>;

/** Bounded publication-specific differences, with a token that refuses a changed work snapshot. */
export const WorkTemplateChangePreview = z.strictObject({
  warnings: z.array(BlueprintPreviewWarning).max(100).default([]),
  versionNumber: z.number().int().positive().optional(),
  workTypeId: WorkTypeId,
  workTypeVersionId: WorkTypeVersionId,
  previewToken,
  changes: z.array(WorkTemplateFieldChange).max(10),
  mode: z.enum(['change', 'update']).default('change'),
  childChanges: z.array(WorkTemplateChildChange).max(4000).default([]),
});
/** Authorized differences for exactly one item and selected publication. */
export type WorkTemplateChangePreview = z.infer<typeof WorkTemplateChangePreview>;

/** Assign identity and only explicitly chosen, previewed starting values; defaults preserve work. */
export const WorkTemplateAssignment = WorkTemplateChangeRequest.extend({
  previewToken: previewToken.optional(),
  applyFields: z.array(WorkTemplateChangeField).max(10).default([]),
  acceptChildChanges: z.array(WorkTemplateChildChangeId).max(4000).default([]),
}).superRefine((selection, context) => {
  if (new Set(selection.applyFields).size !== selection.applyFields.length) {
    context.addIssue({
      code: 'custom',
      path: ['applyFields'],
      message: 'Choose each change once.',
    });
  }
  if (new Set(selection.acceptChildChanges).size !== selection.acceptChildChanges.length)
    context.addIssue({
      code: 'custom',
      path: ['acceptChildChanges'],
      message: 'Choose each change once.',
    });
  if (
    (selection.applyFields.length > 0 || selection.acceptChildChanges.length > 0) &&
    selection.previewToken === undefined
  ) {
    context.addIssue({
      code: 'custom',
      path: ['previewToken'],
      message: 'Review changes before applying starting values.',
    });
  }
});
/** Reviewed reassignment input; omitted choices retain the existing identity-only behavior. */
export type WorkTemplateAssignment = Omit<
  z.infer<typeof WorkTemplateAssignment>,
  'applyFields' | 'acceptChildChanges' | 'mode'
> & {
  readonly mode?: 'change' | 'update';
  readonly acceptChildChanges?: WorkTemplateChildChangeId[] | undefined;
  readonly applyFields?: WorkTemplateChangeField[] | undefined;
};
