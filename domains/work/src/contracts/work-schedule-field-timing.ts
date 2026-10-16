import { z } from 'zod';
import { DayOffset } from './work-template-blueprint';
import { WorkScheduleForestPath } from './work-schedule-forest';

/** Supported private managed date field; compatibility depends on selected work kind. */
export const WorkScheduleField = z.enum(['startDate', 'dueDate', 'targetDate']);
/** Private date field value. */
export type WorkScheduleField = z.infer<typeof WorkScheduleField>;
/** Root-qualified logical work reference, never an execution authority or source row ID. */
export const WorkScheduleTimingRef = WorkScheduleForestPath;
/** Logical selected work reference. */
export type WorkScheduleTimingRef = z.infer<typeof WorkScheduleTimingRef>;
/** One independent date field in an exact selected publication path. */
export const WorkScheduleFieldTarget = WorkScheduleTimingRef.extend({ field: WorkScheduleField });
/** Selected date target. */
export type WorkScheduleFieldTarget = z.infer<typeof WorkScheduleFieldTarget>;
/** Private prerequisite declaration; completion means actual supplied Task facts only. */
export const WorkScheduleFieldSource = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('run') }),
  z.strictObject({
    kind: z.literal('work_date'),
    work: WorkScheduleTimingRef,
    field: WorkScheduleField,
  }),
  z.strictObject({
    kind: z.literal('after_completion'),
    works: z
      .array(WorkScheduleTimingRef)
      .min(1)
      .max(499)
      .refine(
        (refs) =>
          new Set(refs.map((ref) => JSON.stringify([ref.rootKey, ref.path]))).size === refs.length,
        'Completion prerequisites must be distinct.',
      ),
  }),
]);
/** Private prerequisite declaration value. */
export type WorkScheduleFieldSource = z.infer<typeof WorkScheduleFieldSource>;
/** One private managed field; omitted fields remain unmanaged rather than manual nulls. */
export const WorkScheduleFieldRule = z
  .strictObject({
    target: WorkScheduleFieldTarget,
    source: WorkScheduleFieldSource,
    offset: DayOffset,
  })
  .refine(
    (rule) => rule.source.kind !== 'after_completion' || rule.offset.days >= 0,
    'Actual completion offsets cannot be negative.',
  );
/** Private field rule value. */
export type WorkScheduleFieldRule = z.infer<typeof WorkScheduleFieldRule>;
/** Versioned private field vector; never rewrites a retained version1 document. */
export const WorkScheduleFieldTiming = z.strictObject({
  kind: z.literal('field_timing'),
  revision: z.literal(2),
  rules: z
    .array(WorkScheduleFieldRule)
    .max(1000)
    .refine(
      (rules) =>
        new Set(
          rules.map(({ target }) => JSON.stringify([target.rootKey, target.path, target.field])),
        ).size === rules.length,
      'Every managed field has one rule.',
    ),
});
/** Version2 private timing document. */
export type WorkScheduleFieldTiming = z.infer<typeof WorkScheduleFieldTiming>;
