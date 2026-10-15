import { OrganizationId } from '@docket/identity-access/ids';
import { z } from 'zod';
import {
  OccurrenceId,
  ProgramId,
  ProjectId,
  RecurrenceSeriesId,
  RecurrenceSeriesRevisionId,
  TaskId,
  WorkTypeId,
  WorkTypeVersionId,
} from '../ids';
import { BlueprintCivilDate, BlueprintCreationPreview } from './work-template-blueprint';
import { TITLE_MAX } from '../task-titles';
import { WorkScheduleDraft } from './work-schedule';
import { WorkScheduleForest } from './work-schedule-forest';
import { WorkScheduleTrigger } from './work-schedule-trigger';

const name = z
  .string()
  .min(1)
  .max(120)
  .refine((value) => value.trim().length > 0, 'Name the schedule.');
/** Actual first-run identity from the canonical engine, alongside the reviewed child work. */
export const WorkSchedulePreviewOut = BlueprintCreationPreview.extend({
  scheduledFor: BlueprintCivilDate,
  title: z.string().min(1).max(TITLE_MAX),
});
/** Read-only scheduled creation consequence; callers never calculate the first date independently. */
export type WorkSchedulePreviewOut = z.infer<typeof WorkSchedulePreviewOut>;
const authoring = {
  name,
  document: WorkScheduleDraft,
  trigger: WorkScheduleTrigger,
  effectiveFrom: BlueprintCivilDate,
};
interface DraftAndTrigger {
  readonly document: WorkScheduleDraft;
  readonly trigger: WorkScheduleTrigger;
}
function checkTimezone(value: DraftAndTrigger, ctx: z.RefinementCtx): void {
  if (
    value.trigger.kind === 'calendar' &&
    value.trigger.schedule.timezone !== value.document.timezone
  )
    ctx.addIssue({
      code: 'custom',
      path: ['document', 'timezone'],
      message: 'Use the same timezone for the work and its cadence.',
    });
}
/** Native authoring accepts ordinary drafts, never retained execution claims or historical forests. */
export const WorkScheduleCreate = z
  .strictObject({ ...authoring, ownerProgramId: ProgramId.nullable().optional() })
  .superRefine((value, ctx) => {
    checkTimezone(value, ctx);
    if (value.ownerProgramId && value.document.root.kind === 'project') {
      const destination = value.document.root.placement.programId;
      if (destination !== undefined && destination !== value.ownerProgramId)
        ctx.addIssue({
          code: 'custom',
          path: ['document', 'root', 'placement', 'programId'],
          message: 'Use the owning Program as the destination.',
        });
    }
  });
/** Native schedule creation command. */
export type WorkScheduleCreate = z.infer<typeof WorkScheduleCreate>;
/** Future edits require the exact reviewed revision and cannot change ownership. */
export const WorkScheduleRevisionCreate = z
  .strictObject({
    ...authoring,
    name: name.optional(),
    expectedRevisionId: RecurrenceSeriesRevisionId,
  })
  .superRefine(checkTimezone);
/** Reviewed future revision command. */
export type WorkScheduleRevisionCreate = z.infer<typeof WorkScheduleRevisionCreate>;
/** A checked manual run date and bounded idempotency key. */
export const WorkScheduleRunRequest = z.strictObject({
  scheduledFor: BlueprintCivilDate,
  occurrenceKey: z.string().min(1).max(256).optional(),
});
/** Manual run request. */
export type WorkScheduleRunRequest = z.infer<typeof WorkScheduleRunRequest>;
/** Existing schedule lifecycle transitions. */
export const WorkScheduleLifecycle = z.strictObject({ action: z.enum(['pause', 'resume', 'end']) });
/** Lifecycle command. */
export type WorkScheduleLifecycle = z.infer<typeof WorkScheduleLifecycle>;
/** Stable application-owned failures; raw exception/provider messages never cross this contract. */
export const WorkScheduleFailureCode = z.enum([
  'template_unavailable',
  'permission_changed',
  'destination_unavailable',
  'invalid_work',
  'work_limit',
  'creation_failed',
]);
/** Safe failure code value. */
export type WorkScheduleFailureCode = z.infer<typeof WorkScheduleFailureCode>;
/** Public root identity; nested private source aliases stay in restricted storage. */
export const WorkScheduleGeneratedRoot = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('task'), id: TaskId }),
  z.strictObject({ kind: z.literal('project'), id: ProjectId }),
]);
/** Concrete generated root. */
export type WorkScheduleGeneratedRoot = z.infer<typeof WorkScheduleGeneratedRoot>;
/** Authorized version facts, without template body or retained authority. */
export const WorkScheduleUsedTemplate = z.strictObject({
  workTypeId: WorkTypeId,
  workTypeVersionId: WorkTypeVersionId,
});
/** Version used by a run. */
export type WorkScheduleUsedTemplate = z.infer<typeof WorkScheduleUsedTemplate>;
/** One durable run, including visible retry state and actual root references. */
export const WorkScheduleRunOut = z.strictObject({
  id: OccurrenceId,
  seriesId: RecurrenceSeriesId,
  scheduledFor: BlueprintCivilDate,
  originalScheduledFor: BlueprintCivilDate.nullable(),
  status: z.enum([
    'expected',
    'materialized',
    'completed',
    'skipped',
    'canceled',
    'needs_resolution',
    'superseded',
    'failed',
  ]),
  attempt: z.number().int().nonnegative(),
  failureCode: WorkScheduleFailureCode.nullable(),
  failedAt: z.string().nullable(),
  retryAvailableAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  canRetry: z.boolean(),
  roots: z.array(WorkScheduleGeneratedRoot),
  templates: z.array(WorkScheduleUsedTemplate),
});
/** Authorized run representation. */
export type WorkScheduleRunOut = z.infer<typeof WorkScheduleRunOut>;
/** Current private revision; historical forests remain readable without becoming new authoring input. */
export const WorkScheduleRevisionOut = z.strictObject({
  id: RecurrenceSeriesRevisionId,
  number: z.number().int().positive(),
  effectiveFrom: BlueprintCivilDate,
  document: z.union([WorkScheduleDraft, WorkScheduleForest]).nullable(),
  trigger: WorkScheduleTrigger,
  createdAt: z.string(),
});
/** Current schedule revision. */
export type WorkScheduleRevisionOut = z.infer<typeof WorkScheduleRevisionOut>;
/** One visibility-filtered schedule summary; dates use the saved cadence timezone. */
export const WorkScheduleOut = z.strictObject({
  id: RecurrenceSeriesId,
  organizationId: OrganizationId,
  ownerProgramId: ProgramId.nullable(),
  name: z.string().min(1),
  status: z.enum(['active', 'paused', 'ended']),
  revision: WorkScheduleRevisionOut,
  nextRunDate: BlueprintCivilDate.nullable(),
  nextWorkTitle: z.string().min(1).nullable().optional(),
  failedRunCount: z.number().int().nonnegative().optional(),
  templateArchived: z.boolean(),
  retainedTemplate: WorkScheduleUsedTemplate.nullable().default(null),
  canEdit: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  pausedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});
/** Schedule summary. */
export type WorkScheduleOut = z.infer<typeof WorkScheduleOut>;
/** Bounded history page; cursors are opaque to callers. */
export const WorkScheduleRunPage = z.strictObject({
  items: z.array(WorkScheduleRunOut),
  nextCursor: z.string().optional(),
});
/** Run history page. */
export type WorkScheduleRunPage = z.infer<typeof WorkScheduleRunPage>;
/** Current schedule plus one bounded history page. */
export const WorkScheduleDetailOut = WorkScheduleOut.extend({ runs: WorkScheduleRunPage });
/** Authorized schedule detail. */
export type WorkScheduleDetailOut = z.infer<typeof WorkScheduleDetailOut>;
