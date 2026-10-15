/** Acyclic reusable blueprint vocabulary; never imports concrete work-row contracts. */
import { z } from 'zod';
import { TeamId } from '@docket/identity-access/ids';
import { BlueprintStepId, LabelId, WorkTypeId, WorkTypeVersionId } from '../ids';
import { Priority } from '../task-contract';
import { Health, Visibility } from './capability';

/** Stable logical step key within one publication. */
export const StepKey = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
/** Stable logical step key value. */
export type StepKey = z.infer<typeof StepKey>;
/** Supported ISO weekday, Monday through Sunday. */
export const ISOWeekday = z.number().int().min(1).max(7);
/** ISO weekday value. */
export type ISOWeekday = z.infer<typeof ISOWeekday>;
/** Nonempty sorted workspace working-weekday snapshot. */
export const WorkingWeekdays = z
  .array(ISOWeekday)
  .min(1)
  .max(7)
  .refine(
    (days) => days.every((day, index) => index === 0 || day > (days[index - 1] ?? 0)),
    'Use unique sorted weekdays.',
  );
/** Workspace working-weekday snapshot value. */
export type WorkingWeekdays = z.infer<typeof WorkingWeekdays>;
/** Signed calendar or working-day displacement. */
export const DayOffset = z.strictObject({
  days: z.number().int().min(-36500).max(36500),
  unit: z.enum(['calendar', 'working']),
});
/** Day displacement value. */
export type DayOffset = z.infer<typeof DayOffset>;
/** Calendar-weekday snap applied after a day displacement. */
export const WeekdaySnap = z.strictObject({
  direction: z.enum(['next', 'previous']),
  weekday: ISOWeekday,
  inclusive: z.boolean().default(false),
});
/** Calendar-weekday snap value. */
export type WeekdaySnap = z.infer<typeof WeekdaySnap>;
const timingFields = { offset: DayOffset, snap: WeekdaySnap.optional() };
/** Managed relative timing with no literal dates or work-row references. */
export const BlueprintDateRule = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({
    kind: z.literal('anchor'),
    anchor: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('parent') }),
      z.strictObject({ kind: z.literal('milestone'), stepKey: StepKey }),
    ]),
    ...timingFields,
  }),
  z.strictObject({
    kind: z.literal('after_completion'),
    stepKeys: z
      .array(StepKey)
      .min(1)
      .max(499)
      .refine((keys) => new Set(keys).size === keys.length),
    ...timingFields,
    offset: DayOffset.extend({ days: z.number().int().min(0).max(36500) }),
  }),
]);
/** Relative timing rule value. */
export type BlueprintDateRule = z.infer<typeof BlueprintDateRule>;
const name = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'Name the work.');
const commonFields = {
  name,
  summary: z.string().max(280).optional(),
  description: z.string().optional(),
  status: z.string().min(1).optional(),
  health: Health.optional(),
};
/** Reusable Task starting fields shared by drafts and step overrides. */
export const BlueprintTaskFields = z.strictObject({
  title: name,
  summary: z.string().max(200).optional(),
  description: z.string().optional(),
  priority: Priority.optional(),
  state: z.string().min(1).optional(),
  labelIds: z.array(LabelId).optional(),
  estimate: z.number().int().nonnegative().optional(),
  estimateMinutes: z.number().int().nonnegative().nullable().optional(),
});
/** Reusable Project starting fields. */
export const BlueprintProjectFields = z.strictObject({
  ...commonFields,
  priority: Priority.optional(),
});
/** Reusable Program starting fields. */
export const BlueprintProgramFields = z.strictObject({
  ...commonFields,
  visibility: Visibility.optional(),
});
/** Reusable Milestone starting fields. */
export const BlueprintMilestoneFields = z.strictObject({
  name,
  description: z.string().optional(),
});
const template = z
  .strictObject({
    workTypeId: WorkTypeId,
    selection: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('latest') }),
      z.strictObject({ kind: z.literal('pinned'), workTypeVersionId: WorkTypeVersionId }),
    ]),
  })
  .nullable();
const commonStep = {
  key: StepKey,
  parentStepKey: StepKey.nullable(),
  sort: z.number().int().nonnegative(),
  optional: z
    .strictObject({ enabled: z.boolean(), selectedByDefault: z.boolean() })
    .refine(
      (value) => value.enabled || value.selectedByDefault,
      'Required work is selected by default.',
    ),
  template,
  teamRule: z.enum(['parent_team', 'creation_team', 'none']),
  actorRule: z.enum(['parent_responsible', 'creator', 'athena', 'unassigned']),
};
/** Strict kind-correlated reusable step. */
export const BlueprintStep = z.discriminatedUnion('kind', [
  z.strictObject({
    ...commonStep,
    kind: z.literal('task'),
    fields: BlueprintTaskFields,
    cycleRule: z.enum(['none', 'parent_cycle', 'current_cycle']),
    dates: z.strictObject({
      startDate: BlueprintDateRule.optional(),
      dueDate: BlueprintDateRule.optional(),
    }),
  }),
  z.strictObject({
    ...commonStep,
    kind: z.literal('project'),
    fields: BlueprintProjectFields,
    dates: z.strictObject({
      startDate: BlueprintDateRule.optional(),
      targetDate: BlueprintDateRule.optional(),
    }),
  }),
  z.strictObject({
    ...commonStep,
    kind: z.literal('program'),
    fields: BlueprintProgramFields,
    dates: z.strictObject({}),
  }),
  z.strictObject({
    ...commonStep,
    kind: z.literal('milestone'),
    fields: BlueprintMilestoneFields,
    template: z.null(),
    dates: z.strictObject({ targetDate: BlueprintDateRule.optional() }),
  }),
]);
/** Reusable step value. */
export type BlueprintStep = z.infer<typeof BlueprintStep>;
/** Task dependency within one authored blueprint scope. */
export const BlueprintDependency = z
  .strictObject({ blockerStepKey: StepKey, blockedStepKey: StepKey })
  .refine((edge) => edge.blockerStepKey !== edge.blockedStepKey, 'A task cannot block itself.');
/** Authored dependency value. */
export type BlueprintDependency = z.infer<typeof BlueprintDependency>;
/** Bounded reusable child graph. */
export const Blueprint = z
  .strictObject({
    steps: z.array(BlueprintStep).max(499),
    dependencies: z.array(BlueprintDependency).max(2000),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.steps.map((step) => step.key)).size !== value.steps.length)
      ctx.addIssue({ code: 'custom', path: ['steps'], message: 'Step keys must be unique.' });
    if (
      new Set(value.dependencies.map((edge) => JSON.stringify(edge))).size !==
      value.dependencies.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['dependencies'],
        message: 'Dependencies must be unique.',
      });
  });
/** Reusable graph value. */
export type Blueprint = z.infer<typeof Blueprint>;
/** Explicit selection of an optional qualified child path. */
export const OptionalChoice = z.strictObject({
  path: z.array(StepKey).min(1).max(499),
  selected: z.boolean(),
});
/** Explicit optional-child choice value. */
export type OptionalChoice = z.infer<typeof OptionalChoice>;
/** Strict ordinary work civil date. */
export const BlueprintCivilDate = z.iso
  .date()
  .refine(
    (date) => date >= '1970-01-01' && date <= '2200-12-31',
    'Date is outside the ordinary work range.',
  );
/** Independently accepted rule and ownership for one concrete date field. */
export const BlueprintDateBinding = z.strictObject({
  sourceStepId: BlueprintStepId,
  sourceVersionId: WorkTypeVersionId,
  rule: BlueprintDateRule,
  manual: z.boolean().default(false),
  lastDerivedDate: BlueprintCivilDate.nullable(),
});
/** Persisted field-binding value. */
export type BlueprintDateBinding = z.infer<typeof BlueprintDateBinding>;
/** Date bindings; adapters restrict supported fields to the concrete work kind. */
export const BlueprintDateBindings = z.strictObject({
  startDate: BlueprintDateBinding.optional(),
  dueDate: BlueprintDateBinding.optional(),
  targetDate: BlueprintDateBinding.optional(),
});
/** Persisted independently managed date bindings. */
export type BlueprintDateBindings = z.infer<typeof BlueprintDateBindings>;
/** Exact publication resolved at a qualified expansion path. */
export const ResolvedVersionAtPath = z.strictObject({
  path: z.array(StepKey).max(499),
  workTypeId: WorkTypeId,
  versionId: WorkTypeVersionId,
});
/** Exact path/publication value. */
export type ResolvedVersionAtPath = z.infer<typeof ResolvedVersionAtPath>;
/** Bounded root receipt for replay and partial adoption. */
export const BlueprintState = z.strictObject({
  revision: z.number().int().nonnegative(),
  generationKey: z.string().min(1),
  resolvedManifest: z.array(ResolvedVersionAtPath).max(500),
  optionalChoices: z.array(OptionalChoice).max(499),
  creationTimezone: z.string().min(1),
  workingWeekdays: WorkingWeekdays,
  lastApplicationChangeSetId: z.string().nullable(),
  managedDependencies: z
    .array(z.strictObject({ blockerId: z.string().min(1), blockedId: z.string().min(1) }))
    .max(2000)
    .optional(),
});
/** Persisted root receipt value. */
export type BlueprintState = z.infer<typeof BlueprintState>;

/** Independent source identity of an independent canonical template copy. */
export const WorkTemplateOrigin = z.strictObject({
  workTypeId: WorkTypeId,
  workTypeVersionId: WorkTypeVersionId,
});
/** Canonical copy origin; never a reusable work placement. */
export type WorkTemplateOrigin = z.infer<typeof WorkTemplateOrigin>;
/** Read-only creation choices may be reviewed before an acceptance token exists. */
export const BlueprintPreviewOptions = z
  .strictObject({
    previewToken: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    creationTeamId: TeamId.optional(),
    optionalChoices: z.array(OptionalChoice).max(499).default([]),
  })
  .superRefine((input, context) => {
    if (
      new Set(input.optionalChoices.map((choice) => JSON.stringify(choice.path))).size !==
      input.optionalChoices.length
    )
      context.addIssue({
        code: 'custom',
        path: ['optionalChoices'],
        message: 'Choose each optional path once.',
      });
  });
/** Read-only optional-child choices; reviewing a changed choice does not require a previous token. */
export type BlueprintPreviewOptions = z.infer<typeof BlueprintPreviewOptions>;

/** Public creation choices additionally require a reviewed token for explicit optional selections. */
export const BlueprintCreationOptions = BlueprintPreviewOptions.superRefine((input, context) => {
  if (input.optionalChoices.length > 0 && !input.previewToken)
    context.addIssue({
      code: 'custom',
      path: ['previewToken'],
      message: 'Review optional child choices before creation.',
    });
});
/** Validated creation-preview choices. */
export type BlueprintCreationOptions = z.infer<typeof BlueprintCreationOptions>;

/** Bounded, application-owned warning vocabulary shared by planning and public previews. */
export const BlueprintWarningCode = z.enum([
  'actor_unavailable',
  'athena_unavailable',
  'cycle_unavailable',
  'missing_anchor',
  'waiting_completion',
  'label_unavailable',
  'capture_actor',
  'capture_team',
  'capture_cycle',
  'capture_dependency',
  'capture_schedule_assignment',
  'capture_schedule_provider',
  'capture_schedule_cadence',
  'capture_schedule_draft',
  'warning_overflow',
]);
/** Stable preview warning code. */
export type BlueprintWarningCode = z.infer<typeof BlueprintWarningCode>;
const previewPath = z.array(StepKey).max(499);
const previewDate = BlueprintCivilDate.nullable().optional();
const unresolved = z.enum(['missing_anchor', 'waiting_completion']).optional();
/** One descendant summary without body text or a private definition. */
export const BlueprintPreviewSummary = z.strictObject({
  path: previewPath.min(1),
  parentPath: previewPath,
  kind: z.enum(['program', 'project', 'milestone', 'task']),
  title: z.string().max(256),
  workTypeId: WorkTypeId.nullable(),
  workTypeVersionId: WorkTypeVersionId.nullable(),
  dates: z.strictObject({ startDate: previewDate, dueDate: previewDate, targetDate: previewDate }),
  unresolvedReasons: z.strictObject({
    startDate: unresolved,
    dueDate: unresolved,
    targetDate: unresolved,
  }),
  optional: z.boolean(),
  selectedByDefault: z.boolean(),
  selected: z.boolean(),
  prerequisites: z.array(previewPath).max(499),
});
/** Public descendant summary value. */
export type BlueprintPreviewSummary = z.infer<typeof BlueprintPreviewSummary>;
/** A bounded public warning retaining aggregate counts when paths are omitted. */
export const BlueprintPreviewWarning = z.strictObject({
  code: BlueprintWarningCode,
  paths: z.array(previewPath).max(100),
  count: z.number().int().positive(),
});
/** Public planning warning value. */
export type BlueprintPreviewWarning = z.infer<typeof BlueprintPreviewWarning>;
/** An independent default schedule installed on a selected Program in this creation. */
export const ProgramDefaultSchedulePreview = z.strictObject({
  programPath: previewPath,
  programName: z.string(),
  key: StepKey,
  name: z.string().min(1).max(120),
  targetType: z.enum(['task', 'project']),
  workTypeId: WorkTypeId,
  selection: z.enum(['latest', 'pinned']),
  workTypeVersionId: WorkTypeVersionId.nullable(),
  titlePattern: z.string().min(1).max(256),
  cadenceKind: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().positive(),
  firstRunDate: BlueprintCivilDate,
  timezone: z.string().min(1),
});
/** Public creation summary with destination and first run, without private assignments. */
export type ProgramDefaultSchedulePreview = z.infer<typeof ProgramDefaultSchedulePreview>;
/** Read-only creation review; pagination never changes the whole-tree acceptance token. */
export const BlueprintCreationPreview = z.strictObject({
  workTypeId: WorkTypeId,
  workTypeVersionId: WorkTypeVersionId,
  previewToken: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  resolvedManifest: z.array(ResolvedVersionAtPath).max(500),
  descendants: z.array(BlueprintPreviewSummary).max(499),
  descendantCount: z.number().int().nonnegative().max(10000),
  selectedCount: z.number().int().min(1).max(500),
  additionalMilestoneCount: z.number().int().nonnegative().max(499),
  summaryOffset: z.number().int().min(0).max(10000),
  nextSummaryOffset: z.number().int().min(0).max(10000).nullable(),
  warnings: z.array(BlueprintPreviewWarning).max(100),
  defaultSchedules: z.array(ProgramDefaultSchedulePreview).max(10000).default([]),
});
/** Public reviewed creation value. */
export type BlueprintCreationPreview = z.infer<typeof BlueprintCreationPreview>;
