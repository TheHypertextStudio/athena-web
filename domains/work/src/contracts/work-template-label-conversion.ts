import { z } from 'zod';
import {
  LabelGroupId,
  LabelId,
  TaskId,
  ProjectId,
  InitiativeId,
  ProgramId,
  WorkTypeId,
  WorkTypeVersionId,
} from '../ids';

const selection = {
  removeLabelIds: z
    .array(LabelId)
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
  workTypeId: WorkTypeId,
  workTypeVersionId: WorkTypeVersionId,
};
const selectedWork = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('task'), id: TaskId, ...selection }),
  z.strictObject({ kind: z.literal('project'), id: ProjectId, ...selection }),
  z.strictObject({ kind: z.literal('initiative'), id: InitiativeId, ...selection }),
  z.strictObject({ kind: z.literal('program'), id: ProgramId, ...selection }),
]);
/** One explicitly selected batch; no draft, authoring override, or child/field application is accepted. */
export const LabelTemplateConversionChoices = z.strictObject({
  labelGroupId: LabelGroupId,
  items: z
    .array(selectedWork)
    .min(1)
    .max(100)
    .refine(
      (items) => new Set(items.map((item) => `${item.kind}:${item.id}`)).size === items.length,
    ),
});
/** Selected stand-in labels and published work identities. */
export type LabelTemplateConversionChoices = z.infer<typeof LabelTemplateConversionChoices>;
/** The exact authorized work batch, with selected label removals and no starting-value changes. */
export const LabelTemplateConversionReview = z.strictObject({
  labelGroupId: LabelGroupId,
  labelGroupName: z.string(),
  reviewFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  items: z
    .array(
      z.strictObject({
        kind: z.enum(['task', 'project', 'initiative', 'program']),
        id: z.string(),
        name: z.string(),
        templateName: z.string(),
        workTypeId: WorkTypeId,
        workTypeVersionId: WorkTypeVersionId,
        removeLabels: z.array(z.strictObject({ id: LabelId, name: z.string() })).min(1),
      }),
    )
    .min(1)
    .max(100),
});
/** Read-only authorized conversion review. */
export type LabelTemplateConversionReview = z.infer<typeof LabelTemplateConversionReview>;
/** Explicit confirmation bound to the exact current review, retained across interrupted responses. */
export const LabelTemplateConversionConfirm = LabelTemplateConversionChoices.extend({
  requestId: z.uuid(),
  expectedReviewFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
/** Exact confirmed batch command. */
export type LabelTemplateConversionConfirm = z.infer<typeof LabelTemplateConversionConfirm>;
/** One durable aggregate receipt, reversible through the existing change-set engine. */
export const LabelTemplateConversionReceipt = z.strictObject({
  changeSetId: z.string(),
  state: z.enum(['converted', 'undone']),
  itemCount: z.number().int().min(1).max(100),
});
/** Actual persisted conversion outcome. */
export type LabelTemplateConversionReceipt = z.infer<typeof LabelTemplateConversionReceipt>;
