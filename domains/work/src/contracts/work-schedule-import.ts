import { z } from 'zod';
import { WorkScheduleRootDraft } from './work-schedule-fields';
import { ScheduleTemplateSelection } from './work-schedule-defaults';
import {
  ScheduleTimezone,
  WorkScheduleOptionalChoices,
  WorkScheduleStepOverrides,
} from './work-schedule';
import {
  WorkScheduleFieldTiming,
  WorkScheduleFieldTarget,
  WorkScheduleTimingRef,
} from './work-schedule-field-timing';
import { StepKey } from './work-template-blueprint';

/** Exact four-token legacy naming policy; unknown braces remain ordinary literal text. */
export const LegacyScheduleTitlePolicy = z.strictObject({
  kind: z.literal('legacy_title'),
  revision: z.literal(1),
});
/** Saved compatibility naming policy value. */
export type LegacyScheduleTitlePolicy = z.infer<typeof LegacyScheduleTitlePolicy>;
/** Legacy continuation requires actual completedAt facts for exactly these authored Task paths. */
export const LegacyScheduleCompletionPolicy = z.strictObject({
  kind: z.literal('legacy_authored_tasks'),
  revision: z.literal(1),
  tasks: z
    .array(WorkScheduleTimingRef)
    .max(500)
    .refine(
      (values) =>
        new Set(values.map((value) => JSON.stringify([value.rootKey, value.path]))).size ===
        values.length,
      'Each authored Task is required once.',
    ),
});
/** Private completion policy; parsing it confers no occurrence acceptance or execution authority. */
export type LegacyScheduleCompletionPolicy = z.infer<typeof LegacyScheduleCompletionPolicy>;
/** Original immutable evidence pointer supplied by a separately authorized and proved conversion caller. */
export const LegacyScheduleSourceEvidence = z.strictObject({
  kind: z.literal('retained_source'),
  revision: z.literal(1),
  revisionAlias: z.string().min(1),
  invocationId: z.string().min(1),
  originalFingerprint: z.string().regex(/^[a-f0-9]{32}$/),
  archiveHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
/** Descriptive source lineage, never a verified receipt or an accepted claim. */
export type LegacyScheduleSourceEvidence = z.infer<typeof LegacyScheduleSourceEvidence>;
/** Exact original aliases/order mapped to canonical logical paths; no physical generated-work IDs. */
export const LegacyScheduleSourceMapping = z.strictObject({
  alias: z.string().min(1),
  sourceKey: z.string(),
  reference: WorkScheduleTimingRef,
  kind: z.enum(['task', 'project', 'milestone']),
  sort: z.number().int().nonnegative(),
});
/** Private source alias projection value. */
export type LegacyScheduleSourceMapping = z.infer<typeof LegacyScheduleSourceMapping>;
const selectedWork = z.strictObject({
  reference: WorkScheduleTimingRef,
  kind: z.enum(['task', 'project', 'milestone']),
});
const timing = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('on_trigger') }),
  z.strictObject({ kind: z.literal('relative_to_trigger'), offsetDays: z.number().int() }),
  z.strictObject({
    kind: z.literal('after_step_completion'),
    stepKey: z.string(),
    offsetDays: z.number().int(),
  }),
]);
/** Original private declaration; unsupported offsets stay intact for a nonexecuting review disposition. */
export const LegacyScheduleSourceStep = z.strictObject({
  key: z.string(),
  kind: z.enum(['task', 'project', 'milestone']),
  timing,
  fieldOverrides: z.record(z.string(), z.json()),
  dependsOn: z.array(z.string()).optional(),
});
/** Private legacy source declaration value. */
export type LegacyScheduleSourceStep = z.infer<typeof LegacyScheduleSourceStep>;
/** Existing ordinary root/child draft validators, with nullable retained selections preserved without latest resolution. */
export const LegacyScheduleImportRoot = z.strictObject({
  key: StepKey,
  template: ScheduleTemplateSelection.nullable(),
  root: WorkScheduleRootDraft.nullable(),
  stepOverrides: WorkScheduleStepOverrides,
  optionalChoices: WorkScheduleOptionalChoices,
});
/** Retained private authoring root value. */
export type LegacyScheduleImportRoot = z.infer<typeof LegacyScheduleImportRoot>;
/** Strict internal compiler input; immutable source body is preserved independently of bounded executable projections. */
export const LegacyScheduleImportInput = z.strictObject({
  source: LegacyScheduleSourceEvidence,
  sourceBody: z.json(),
  state: z.enum(['published', 'pending_draft']),
  creationMode: z.enum(['all_at_once', 'when_ready']),
  roots: z.array(LegacyScheduleImportRoot),
  steps: z.array(LegacyScheduleSourceStep),
  sourceMappings: z.array(LegacyScheduleSourceMapping),
  selectedWork: z.array(selectedWork),
});
/** Private compiler input; its caller must prove all source evidence and logical selections first. */
export type LegacyScheduleImportInput = z.infer<typeof LegacyScheduleImportInput>;
/** Saved nonexecuting review disposition; none permits scheduler dispatch or partial work creation. */
export const LegacyScheduleImportDisposition = z.enum([
  'pending_source',
  'missing_selection',
  'oversized_source',
  'invalid_structure',
  'unsupported_timing',
]);
/** Stable owned review reason. */
export type LegacyScheduleImportDisposition = z.infer<typeof LegacyScheduleImportDisposition>;
/** Lossless pending envelope; original empty/null/oversized data is never coerced into a runnable forest. */
export const PendingPrivateWorkDefinition = z.strictObject({
  kind: z.literal('pending_private_definition'),
  revision: z.literal(1),
  disposition: LegacyScheduleImportDisposition,
  source: LegacyScheduleImportInput,
});
/** Nonexecuting retained private source value. */
export type PendingPrivateWorkDefinition = z.infer<typeof PendingPrivateWorkDefinition>;
const title = z.strictObject({
  target: WorkScheduleTimingRef,
  kind: z.enum(['task', 'project', 'milestone']),
  pattern: z.string(),
});
const publishedRoot = LegacyScheduleImportRoot.extend({
  template: ScheduleTemplateSelection,
  root: WorkScheduleRootDraft,
}).refine(
  (value) =>
    value.template.selection.kind === 'pinned' && value.template.targetType === value.root.kind,
  'Imported publications require an exact matching pinned selection.',
);
/** Private imported v2 candidate: semantic compilation is distinct from acceptance, activation and authority. */
export const CanonicalImportedSchedule = z.strictObject({
  kind: z.literal('imported_schedule'),
  revision: z.literal(2),
  state: z.literal('published'),
  creationMode: z.enum(['all_at_once', 'when_ready']),
  source: LegacyScheduleSourceEvidence,
  roots: z.array(publishedRoot).min(1).max(500),
  sourceMappings: z.array(LegacyScheduleSourceMapping).min(1).max(500),
  selectedWork: z.array(selectedWork).min(1).max(500),
  timing: WorkScheduleFieldTiming,
  // Explicit suppression prevents native root/template defaults from managing absent legacy fields.
  absentFields: z.array(WorkScheduleFieldTarget).max(1000),
  titlePolicy: LegacyScheduleTitlePolicy,
  titles: z.array(title).min(1).max(500),
  completionPolicy: LegacyScheduleCompletionPolicy,
});
/** A pure candidate only; canonical runtime registration must separately authorize/prove all actual mappings. */
export type CanonicalImportedSchedule = z.infer<typeof CanonicalImportedSchedule>;
/** Pure import outcome; preserved review data and a compiled candidate both remain non-authoritative. */
export type LegacyScheduleImportResult =
  | { readonly kind: 'compiled_import'; readonly candidate: CanonicalImportedSchedule }
  | { readonly kind: 'nonexecuting_import'; readonly pending: PendingPrivateWorkDefinition };

/** An immutable publication fact used only to prepare a nonexecuting conversion candidate. */
export const ScheduleConversionPublication = z.strictObject({
  rootKey: z.string().min(1),
  path: z.array(z.string()),
  workTypeId: z.string().min(1),
  versionId: z.string().min(1),
  definitionHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
/** Exact original publication fact; it is distinct from a pre-work native accepted claim. */
export type ScheduleConversionPublication = z.infer<typeof ScheduleConversionPublication>;
/** Immutable descriptive conversion metadata; runtime never dispatches from this receipt. */
export const ScheduleConversionReceipt = z.strictObject({
  kind: z.literal('schedule_conversion'),
  revision: z.literal(1),
  execution: z.literal('nonexecuting'),
  compiler: z.literal('legacy_schedule_v2.1'),
  identity: z.strictObject({
    organizationId: z.string().min(1),
    seriesId: z.string().min(1),
    seriesRevisionId: z.string().min(1),
    headId: z.string().min(1),
    revisionAlias: z.string().min(1),
    invocationId: z.string().min(1),
  }),
  candidate: CanonicalImportedSchedule,
  publications: z.array(ScheduleConversionPublication).min(1).max(500),
  timezone: z.strictObject({ kind: z.literal('calendar_revision'), timezone: ScheduleTimezone }),
});
/** Parsing records facts only; activation requires separate checked registration and revalidation. */
export type ScheduleConversionReceipt = z.infer<typeof ScheduleConversionReceipt>;
