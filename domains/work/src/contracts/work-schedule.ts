import { z } from 'zod';
import { ScheduleTitlePattern } from '../schedule-title-pattern';
import { DailySchedule } from './recurrence';
import { OptionalChoice } from './work-template-blueprint';
import { ScheduleTemplateSelection } from './work-schedule-defaults';
import { WorkScheduleRootDraft, WorkScheduleStepOverride } from './work-schedule-fields';

/** Saved civil-time context; invalid timezone names cannot become accepted schedule execution context. */
export const ScheduleTimezone = DailySchedule.shape.timezone.refine((value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'Use a recognized timezone.');
/** Valid saved timezone identifier. */
export type ScheduleTimezone = z.infer<typeof ScheduleTimezone>;
/** Distinct explicit optional choices shared by native schedules and their accepted claims. */
export const WorkScheduleOptionalChoices = z
  .array(OptionalChoice)
  .max(499)
  .refine(
    (choices) =>
      new Set(choices.map((choice) => JSON.stringify(choice.path))).size === choices.length,
    'Choose each optional path once.',
  );
/** Bounded private child overrides, keyed by canonical logical path. */
export const WorkScheduleStepOverrides = z
  .array(WorkScheduleStepOverride)
  .max(499)
  .refine(
    (values) => new Set(values.map((value) => JSON.stringify(value.path))).size === values.length,
    'Override each child path once.',
  );
/** Private revision draft; normalized cadence columns remain the single scheduling authority. */
export const WorkScheduleDraft = z
  .strictObject({
    kind: z.literal('schedule'),
    revision: z.literal(1),
    template: ScheduleTemplateSelection,
    titlePattern: ScheduleTitlePattern,
    timezone: ScheduleTimezone,
    root: WorkScheduleRootDraft,
    stepOverrides: WorkScheduleStepOverrides,
    optionalChoices: WorkScheduleOptionalChoices,
  })
  .refine((value) => value.template.targetType === value.root.kind, {
    path: ['root', 'kind'],
    message: 'The selected template must match the scheduled root kind.',
  });
/** Private canonical schedule draft; parsing data never grants retained execution authority. */
export type WorkScheduleDraft = z.infer<typeof WorkScheduleDraft>;
