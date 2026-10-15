import { AutomationEventMatch } from '@docket/automation/contracts';
import { z } from 'zod';
import {
  AfterCompletionSchedule,
  CalendarRecurrenceSchedule,
  MaterializationPolicy,
  MissedOccurrencePolicy,
} from './recurrence';

/** Work started explicitly by a person or an authorized action. */
export const ManualScheduleTrigger = z.strictObject({ kind: z.literal('manual') });
/** Explicit trigger value. */
export type ManualScheduleTrigger = z.infer<typeof ManualScheduleTrigger>;
/** Existing calendar cadence and rolling-window policy. */
export const CalendarScheduleTrigger = z.strictObject({
  kind: z.literal('calendar'),
  schedule: CalendarRecurrenceSchedule,
  missedPolicy: MissedOccurrencePolicy.default('skip'),
  materialization: MaterializationPolicy.default({ horizonDays: 28, minimumOccurrences: 2 }),
});
/** Calendar trigger value. */
export type CalendarScheduleTrigger = z.infer<typeof CalendarScheduleTrigger>;
/** Existing completion-anchored cadence. */
export const CompletionScheduleTrigger = AfterCompletionSchedule;
/** Completion trigger value. */
export type CompletionScheduleTrigger = z.infer<typeof CompletionScheduleTrigger>;
/** Stable event matching remains owned by the automation domain. */
export const EventScheduleTrigger = z
  .strictObject({ kind: z.literal('event'), event: AutomationEventMatch })
  .refine((value) => Object.keys(value.event).length > 0, {
    path: ['event'],
    message: 'Choose at least one event field.',
  });
/** Event trigger value. */
export type EventScheduleTrigger = z.infer<typeof EventScheduleTrigger>;
/** Canonical retained scheduler trigger; templates supply the work, not another engine. */
export const WorkScheduleTrigger = z.union([
  ManualScheduleTrigger,
  CalendarScheduleTrigger,
  CompletionScheduleTrigger,
  EventScheduleTrigger,
]);
/** Work schedule trigger value. */
export type WorkScheduleTrigger = z.infer<typeof WorkScheduleTrigger>;
