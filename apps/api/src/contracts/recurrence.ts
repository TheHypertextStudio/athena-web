/**
 * `domain packages` — deterministic recurrence and process-execution contracts.
 *
 * @remarks
 * Schedule union arms are named schemas so consumers can narrow, document, and test each behavior
 * independently. The union is Docket's canonical model; RRULE is an adapter format, not stored
 * behavioral state. A repeating task is represented as a one-step process by the API.
 */
import { z } from 'zod';

import { AutomationEventMatch } from '@docket/automation/contracts';

import { ActorId, OrganizationId, TeamId } from '@docket/identity-access/ids';
import { CalendarItemId, CalendarLayerId } from '@docket/planning/ids';
import {
  CycleId,
  LabelId,
  MilestoneId,
  OccurrenceId,
  ProgramId,
  ProcessDefinitionId,
  ProcessInstanceId,
  ProcessRevisionId,
  ProjectId,
  RecurrenceSeriesId,
  RecurrenceSeriesRevisionId,
  TaskId,
} from '@docket/work/ids';
import { Health } from '@docket/work/capability-contract';
import { Priority } from '@docket/work/task-contract';
import { ProjectStatus } from './project';
import { TaskCreate, TaskOut } from '@docket/work/task-model';

/** A weekday in an explicit, locale-independent recurrence rule. */
export const RecurrenceWeekday = z.enum([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);
/** Recurrence weekday value. */
export type RecurrenceWeekday = z.infer<typeof RecurrenceWeekday>;

/** A series with no configured end. */
export const NeverEnd = z.object({ kind: z.literal('never') }).strict();
/** Never-ending recurrence value. */
export type NeverEnd = z.infer<typeof NeverEnd>;

/** A series ending on an inclusive calendar date. */
export const OnDateEnd = z.object({ kind: z.literal('on_date'), date: z.iso.date() }).strict();
/** Date-ending recurrence value. */
export type OnDateEnd = z.infer<typeof OnDateEnd>;

/** A series ending after a fixed number of expected occurrences. */
export const AfterCountEnd = z
  .object({ kind: z.literal('after_count'), count: z.number().int().positive() })
  .strict();
/** Count-ending recurrence value. */
export type AfterCountEnd = z.infer<typeof AfterCountEnd>;

/** How a calendar recurrence stops. */
export const RecurrenceEnd = z.discriminatedUnion('kind', [NeverEnd, OnDateEnd, AfterCountEnd]);
/** Recurrence end value. */
export type RecurrenceEnd = z.infer<typeof RecurrenceEnd>;

const CalendarScheduleFields = {
  interval: z.number().int().positive().default(1),
  startDate: z.iso.date(),
  timezone: z.string().min(1),
  end: RecurrenceEnd.default({ kind: 'never' }),
} as const;

/** A calendar schedule occurring every N days. */
export const DailySchedule = z
  .object({ kind: z.literal('daily'), ...CalendarScheduleFields })
  .strict();
/** Daily schedule value. */
export type DailySchedule = z.infer<typeof DailySchedule>;

/** A calendar schedule occurring on one or more weekdays every N weeks. */
export const WeeklySchedule = z
  .object({
    kind: z.literal('weekly'),
    ...CalendarScheduleFields,
    weekdays: z.array(RecurrenceWeekday).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.weekdays).size === value.weekdays.length) return;
    ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'Weekdays must be unique' });
  });
/** Weekly schedule value. */
export type WeeklySchedule = z.infer<typeof WeeklySchedule>;

/** What to do when a numbered day does not exist in a month or year. */
export const CalendarOverflow = z.enum(['skip', 'last_day']);
/** Calendar overflow value. */
export type CalendarOverflow = z.infer<typeof CalendarOverflow>;

/** A monthly pattern targeting a numbered day. */
export const DayOfMonthPattern = z
  .object({
    kind: z.literal('day_of_month'),
    day: z.number().int().min(1).max(31),
    overflow: CalendarOverflow.default('skip'),
  })
  .strict();
/** Day-of-month pattern value. */
export type DayOfMonthPattern = z.infer<typeof DayOfMonthPattern>;

/** A monthly pattern targeting the first-through-fifth or last weekday. */
export const NthWeekdayPattern = z
  .object({
    kind: z.literal('nth_weekday'),
    ordinal: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(-1),
    ]),
    weekday: RecurrenceWeekday,
  })
  .strict();
/** Nth-weekday pattern value. */
export type NthWeekdayPattern = z.infer<typeof NthWeekdayPattern>;

/** The calendar pattern within a monthly schedule. */
export const MonthlyPattern = z.discriminatedUnion('kind', [DayOfMonthPattern, NthWeekdayPattern]);
/** Monthly pattern value. */
export type MonthlyPattern = z.infer<typeof MonthlyPattern>;

/** A calendar schedule occurring every N months. */
export const MonthlySchedule = z
  .object({ kind: z.literal('monthly'), ...CalendarScheduleFields, pattern: MonthlyPattern })
  .strict();
/** Monthly schedule value. */
export type MonthlySchedule = z.infer<typeof MonthlySchedule>;

/** A calendar schedule occurring every N years on a month and day. */
export const YearlySchedule = z
  .object({
    kind: z.literal('yearly'),
    ...CalendarScheduleFields,
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
    overflow: CalendarOverflow.default('skip'),
  })
  .strict();
/** Yearly schedule value. */
export type YearlySchedule = z.infer<typeof YearlySchedule>;

/** A schedule whose next occurrence is anchored to the prior task's actual completion. */
export const AfterCompletionSchedule = z
  .object({
    kind: z.literal('after_completion'),
    interval: z.number().int().positive(),
    unit: z.enum(['day', 'week', 'month']),
  })
  .strict();
/** Completion-anchored schedule value. */
export type AfterCompletionSchedule = z.infer<typeof AfterCompletionSchedule>;

/** Calendar-driven schedule arms. */
export const CalendarRecurrenceSchedule = z.discriminatedUnion('kind', [
  DailySchedule,
  WeeklySchedule,
  MonthlySchedule,
  YearlySchedule,
]);
/** Calendar recurrence schedule value. */
export type CalendarRecurrenceSchedule = z.infer<typeof CalendarRecurrenceSchedule>;

/** Any schedule Docket can execute, discriminated by `kind`. */
export const RecurrenceSchedule = z.union([CalendarRecurrenceSchedule, AfterCompletionSchedule]);
/** Recurrence schedule value. */
export type RecurrenceSchedule = z.infer<typeof RecurrenceSchedule>;

/** Calendar behavior when an expected occurrence passes unfinished. */
export const MissedOccurrencePolicy = z.enum(['skip', 'carry', 'resolve']);
/** Missed-occurrence policy value. */
export type MissedOccurrencePolicy = z.infer<typeof MissedOccurrencePolicy>;

/** Rolling materialization policy used to make scheduled work visible to planning. */
export const MaterializationPolicy = z
  .object({
    horizonDays: z.number().int().min(1).max(366).default(28),
    minimumOccurrences: z.number().int().min(1).max(100).default(2),
  })
  .strict();
/** Materialization policy value. */
export type MaterializationPolicy = z.infer<typeof MaterializationPolicy>;

/** Create a calendar-driven one-step process from an ordinary task draft. */
export const CalendarRecurringTaskCreate = z
  .object({
    task: TaskCreate,
    schedule: CalendarRecurrenceSchedule,
    missedPolicy: MissedOccurrencePolicy.default('skip'),
    materialization: MaterializationPolicy.default({ horizonDays: 28, minimumOccurrences: 2 }),
  })
  .strict();
/** Calendar recurring-task create value. */
export type CalendarRecurringTaskCreate = z.infer<typeof CalendarRecurringTaskCreate>;

/** Create a completion-anchored one-step process from an ordinary task draft. */
export const CompletionRecurringTaskCreate = z
  .object({
    task: TaskCreate,
    schedule: AfterCompletionSchedule,
    missedPolicy: MissedOccurrencePolicy.optional(),
    materialization: MaterializationPolicy.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.missedPolicy !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['missedPolicy'],
        message: 'Completion-anchored work does not have a missed-date policy',
      });
    }
    if (value.materialization !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['materialization'],
        message: 'Completion-anchored work materializes from completion events',
      });
    }
  });
/** Completion recurring-task create value. */
export type CompletionRecurringTaskCreate = z.infer<typeof CompletionRecurringTaskCreate>;

/** Create a repeating task, represented internally as a one-step process. */
export const RecurringTaskCreate = z.union([
  CalendarRecurringTaskCreate,
  CompletionRecurringTaskCreate,
]);
/** Recurring-task create value. */
export type RecurringTaskCreate = z.infer<typeof RecurringTaskCreate>;

/** A stable author-defined key used to reference a process step across revisions. */
export const ProcessStepKey = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
/** Process-step key value. */
export type ProcessStepKey = z.infer<typeof ProcessStepKey>;

/** A process step created as soon as its instance is triggered. */
export const OnTriggerTiming = z.object({ kind: z.literal('on_trigger') }).strict();
/** On-trigger timing value. */
export type OnTriggerTiming = z.infer<typeof OnTriggerTiming>;

/** A process step dated a signed number of calendar days from its occurrence. */
export const RelativeToTriggerTiming = z
  .object({ kind: z.literal('relative_to_trigger'), offsetDays: z.number().int() })
  .strict();
/** Trigger-relative timing value. */
export type RelativeToTriggerTiming = z.infer<typeof RelativeToTriggerTiming>;

/** A process step released after another step completes. */
export const AfterStepCompletionTiming = z
  .object({
    kind: z.literal('after_step_completion'),
    stepKey: ProcessStepKey,
    offsetDays: z.number().int().min(0).default(0),
  })
  .strict();
/** After-step-completion timing value. */
export type AfterStepCompletionTiming = z.infer<typeof AfterStepCompletionTiming>;

/** When one process step becomes ready and how its target day is calculated. */
export const ProcessStepTiming = z.discriminatedUnion('kind', [
  OnTriggerTiming,
  RelativeToTriggerTiming,
  AfterStepCompletionTiming,
]);
/** Process-step timing value. */
export type ProcessStepTiming = z.infer<typeof ProcessStepTiming>;

/** A process started explicitly by a person, Athena, or an automation action. */
export const ManualProcessTrigger = z.object({ kind: z.literal('manual') }).strict();
/** Manual process trigger value. */
export type ManualProcessTrigger = z.infer<typeof ManualProcessTrigger>;

/** A process started from a calendar recurrence and rolling materialization policy. */
export const CalendarProcessTrigger = z
  .object({
    kind: z.literal('calendar'),
    schedule: CalendarRecurrenceSchedule,
    missedPolicy: MissedOccurrencePolicy.default('skip'),
    materialization: MaterializationPolicy.default({ horizonDays: 28, minimumOccurrences: 2 }),
  })
  .strict();
/** Calendar process trigger value. */
export type CalendarProcessTrigger = z.infer<typeof CalendarProcessTrigger>;

/** A process started a duration after the preceding instance completes. */
export const AfterCompletionProcessTrigger = z
  .object({
    kind: z.literal('after_completion'),
    interval: z.number().int().positive(),
    unit: z.enum(['day', 'week', 'month']),
  })
  .strict();
/** After-completion process trigger value. */
export type AfterCompletionProcessTrigger = z.infer<typeof AfterCompletionProcessTrigger>;

/** A process started when a matching Docket or integration event is observed. */
export const EventProcessTrigger = z
  .object({ kind: z.literal('event'), event: AutomationEventMatch })
  .strict()
  .superRefine((value, ctx) => {
    if (Object.keys(value.event).length > 0) return;
    ctx.addIssue({
      code: 'custom',
      path: ['event'],
      message: 'An event trigger must match at least one stable event field',
    });
  });
/** Event process trigger value. */
export type EventProcessTrigger = z.infer<typeof EventProcessTrigger>;

/** How a process instance is triggered, as named behavior-bearing arms. */
export const ProcessTrigger = z.union([
  ManualProcessTrigger,
  CalendarProcessTrigger,
  AfterCompletionProcessTrigger,
  EventProcessTrigger,
]);
/** Process trigger value. */
export type ProcessTrigger = z.infer<typeof ProcessTrigger>;

/** Whether a process creates its full fixed plan or releases steps only when ready. */
export const ProcessCreationMode = z.enum(['all_at_once', 'when_ready']);
/** Process creation mode value. */
export type ProcessCreationMode = z.infer<typeof ProcessCreationMode>;

/** Reusable project specification within a process revision. */
export const ProcessProjectSpec = z
  .object({
    key: ProcessStepKey,
    name: z.string().min(1),
    summary: z.string().max(280).optional(),
    description: z.string().optional(),
    leadId: ActorId.optional(),
    teamId: TeamId.optional(),
    programId: ProgramId.optional(),
    status: ProjectStatus.default('planned'),
    health: Health.optional(),
    startOffsetDays: z.number().int().optional(),
    targetOffsetDays: z.number().int().optional(),
    labelIds: z.array(LabelId).default([]),
    timing: ProcessStepTiming.default({ kind: 'on_trigger' }),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.startOffsetDays !== undefined &&
      value.targetOffsetDays !== undefined &&
      value.targetOffsetDays < value.startOffsetDays
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetOffsetDays'],
        message: 'Project target offset cannot fall before its start offset',
      });
    }
  });
/** Process project specification value. */
export type ProcessProjectSpec = z.infer<typeof ProcessProjectSpec>;

/** Reusable milestone specification within a process revision. */
export const ProcessMilestoneSpec = z
  .object({
    key: ProcessStepKey,
    projectKey: ProcessStepKey,
    name: z.string().min(1),
    description: z.string().optional(),
    sort: z.number().int().min(0).default(0),
    targetOffsetDays: z.number().int().optional(),
    timing: ProcessStepTiming.default({ kind: 'on_trigger' }),
  })
  .strict();
/** Process milestone specification value. */
export type ProcessMilestoneSpec = z.infer<typeof ProcessMilestoneSpec>;

/** Reusable task specification within a process revision. */
export const ProcessTaskSpec = z
  .object({
    key: ProcessStepKey,
    title: z.string().min(1),
    description: z.string().optional(),
    teamId: TeamId,
    state: z.string().min(1).optional(),
    priority: Priority.default('none'),
    assigneeId: ActorId.optional(),
    projectId: ProjectId.optional(),
    projectKey: ProcessStepKey.optional(),
    milestoneId: MilestoneId.optional(),
    milestoneKey: ProcessStepKey.optional(),
    cycleId: CycleId.optional(),
    parentTaskId: TaskId.optional(),
    parentTaskKey: ProcessStepKey.optional(),
    estimate: z.number().int().min(0).optional(),
    estimateMinutes: z.number().int().min(0).optional(),
    startOffsetDays: z.number().int().optional(),
    dueOffsetDays: z.number().int().optional(),
    labelIds: z.array(LabelId).default([]),
    timing: ProcessStepTiming.default({ kind: 'on_trigger' }),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const [fixedField, generatedField] of [
      ['projectId', 'projectKey'],
      ['milestoneId', 'milestoneKey'],
      ['parentTaskId', 'parentTaskKey'],
    ] as const) {
      if (value[fixedField] === undefined || value[generatedField] === undefined) continue;
      ctx.addIssue({
        code: 'custom',
        path: [fixedField],
        message: 'A task reference must be either fixed or generated, not both',
      });
    }
    if (
      value.startOffsetDays !== undefined &&
      value.dueOffsetDays !== undefined &&
      value.dueOffsetDays < value.startOffsetDays
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['dueOffsetDays'],
        message: 'Due-date offset cannot fall before the start-date offset',
      });
    }
  });
/** Process task specification value. */
export type ProcessTaskSpec = z.infer<typeof ProcessTaskSpec>;

/** A blocking edge between two task steps in one process revision. */
export const ProcessDependencySpec = z
  .object({ blockingStepKey: ProcessStepKey, blockedStepKey: ProcessStepKey })
  .strict();
/** Process dependency specification value. */
export type ProcessDependencySpec = z.infer<typeof ProcessDependencySpec>;

/** Body for creating a reusable process and its first immutable revision. */
export const ProcessDefinitionCreate = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    creationMode: ProcessCreationMode.default('all_at_once'),
    project: ProcessProjectSpec.optional(),
    milestones: z.array(ProcessMilestoneSpec).default([]),
    tasks: z.array(ProcessTaskSpec).min(1),
    dependencies: z.array(ProcessDependencySpec).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const keys = [
      ...(value.project === undefined ? [] : [value.project.key]),
      ...value.milestones.map((step) => step.key),
      ...value.tasks.map((step) => step.key),
    ];
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['tasks'],
        message: 'Process step keys must be unique',
      });
    }

    const known = new Set(keys);
    const taskKeys = new Set(value.tasks.map((step) => step.key));
    const milestoneKeys = new Set(value.milestones.map((step) => step.key));
    const projectKeys = new Set(value.project === undefined ? [] : [value.project.key]);
    const hasBadReference =
      value.dependencies.some(
        (edge) =>
          !taskKeys.has(edge.blockingStepKey) ||
          !taskKeys.has(edge.blockedStepKey) ||
          edge.blockingStepKey === edge.blockedStepKey,
      ) ||
      value.milestones.some((step) => !projectKeys.has(step.projectKey)) ||
      value.tasks.some(
        (step) =>
          (step.projectKey !== undefined && !projectKeys.has(step.projectKey)) ||
          (step.milestoneKey !== undefined && !milestoneKeys.has(step.milestoneKey)) ||
          (step.parentTaskKey !== undefined && !taskKeys.has(step.parentTaskKey)) ||
          (step.timing.kind === 'after_step_completion' && !known.has(step.timing.stepKey)),
      );
    if (hasBadReference) {
      ctx.addIssue({
        code: 'custom',
        path: ['dependencies'],
        message: 'Every process reference must name a compatible step in this revision',
      });
    }
  });
/** Process-definition create value. */
export type ProcessDefinitionCreate = z.infer<typeof ProcessDefinitionCreate>;

/** Snapshot one existing project's current shape into a reusable process revision. */
export const ProcessDefinitionFromProjectCreate = z
  .object({
    projectId: ProjectId,
    name: z.string().min(1).optional(),
    creationMode: ProcessCreationMode.default('all_at_once'),
  })
  .strict();
/** Existing-project snapshot command value. */
export type ProcessDefinitionFromProjectCreate = z.infer<typeof ProcessDefinitionFromProjectCreate>;

/** Lifecycle state of a reusable process definition. */
export const ProcessDefinitionStatus = z.enum(['draft', 'published', 'archived']);
/** Process-definition lifecycle value. */
export type ProcessDefinitionStatus = z.infer<typeof ProcessDefinitionStatus>;

/** Public immutable process-revision representation. */
export const ProcessRevisionOut = z
  .object({
    id: ProcessRevisionId,
    definitionId: ProcessDefinitionId,
    number: z.number().int().positive(),
    creationMode: ProcessCreationMode,
    project: ProcessProjectSpec.optional(),
    milestones: z.array(ProcessMilestoneSpec),
    tasks: z.array(ProcessTaskSpec),
    dependencies: z.array(ProcessDependencySpec),
    publishedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();
/** Process-revision output value. */
export type ProcessRevisionOut = z.infer<typeof ProcessRevisionOut>;

/** Compact reusable-process representation for list and picker surfaces. */
export const ProcessDefinitionSummaryOut = z
  .object({
    id: ProcessDefinitionId,
    organizationId: OrganizationId,
    name: z.string(),
    description: z.string().nullable(),
    status: ProcessDefinitionStatus,
    latestRevisionNumber: z.number().int().positive(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
/** Process-definition summary output value. */
export type ProcessDefinitionSummaryOut = z.infer<typeof ProcessDefinitionSummaryOut>;

/** Full reusable process together with the immutable revision future runs use. */
export const ProcessDefinitionDetailOut = ProcessDefinitionSummaryOut.extend({
  revision: ProcessRevisionOut,
}).strict();
/** Process-definition detail output value. */
export type ProcessDefinitionDetailOut = z.infer<typeof ProcessDefinitionDetailOut>;

/** Mutable definition metadata; executable edits are appended as immutable revisions. */
export const ProcessDefinitionUpdate = z
  .object({ name: z.string().min(1).optional(), description: z.string().nullable().optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });
/** Process-definition metadata update value. */
export type ProcessDefinitionUpdate = z.infer<typeof ProcessDefinitionUpdate>;

/** A generated Project mapped to its source process step. */
export const ProcessInstanceProjectItem = z
  .object({ kind: z.literal('project'), stepKey: ProcessStepKey, projectId: ProjectId })
  .strict();
/** Generated project item value. */
export type ProcessInstanceProjectItem = z.infer<typeof ProcessInstanceProjectItem>;

/** A generated Milestone mapped to its source process step. */
export const ProcessInstanceMilestoneItem = z
  .object({ kind: z.literal('milestone'), stepKey: ProcessStepKey, milestoneId: MilestoneId })
  .strict();
/** Generated milestone item value. */
export type ProcessInstanceMilestoneItem = z.infer<typeof ProcessInstanceMilestoneItem>;

/** A generated Task mapped to its source process step. */
export const ProcessInstanceTaskItem = z
  .object({ kind: z.literal('task'), stepKey: ProcessStepKey, taskId: TaskId })
  .strict();
/** Generated task item value. */
export type ProcessInstanceTaskItem = z.infer<typeof ProcessInstanceTaskItem>;

/** One concrete work item created for a process instance. */
export const ProcessInstanceItem = z.discriminatedUnion('kind', [
  ProcessInstanceProjectItem,
  ProcessInstanceMilestoneItem,
  ProcessInstanceTaskItem,
]);
/** Process-instance item value. */
export type ProcessInstanceItem = z.infer<typeof ProcessInstanceItem>;

/** Mark an occurrence completed without changing its scheduled date. */
export const CompleteOccurrenceResolution = z.object({ kind: z.literal('complete') }).strict();
/** Completed occurrence resolution value. */
export type CompleteOccurrenceResolution = z.infer<typeof CompleteOccurrenceResolution>;

/** Mark an occurrence intentionally skipped. */
export const SkipOccurrenceResolution = z.object({ kind: z.literal('skip') }).strict();
/** Skipped occurrence resolution value. */
export type SkipOccurrenceResolution = z.infer<typeof SkipOccurrenceResolution>;

/** Cancel one expected occurrence. */
export const CancelOccurrenceResolution = z.object({ kind: z.literal('cancel') }).strict();
/** Canceled occurrence resolution value. */
export type CancelOccurrenceResolution = z.infer<typeof CancelOccurrenceResolution>;

/** Move one occurrence to a replacement date. */
export const RescheduleOccurrenceResolution = z
  .object({ kind: z.literal('reschedule'), scheduledFor: z.iso.date() })
  .strict();
/** Rescheduled occurrence resolution value. */
export type RescheduleOccurrenceResolution = z.infer<typeof RescheduleOccurrenceResolution>;

/** A person-recorded outcome for one occurrence. */
export const OccurrenceResolution = z.discriminatedUnion('kind', [
  CompleteOccurrenceResolution,
  SkipOccurrenceResolution,
  CancelOccurrenceResolution,
  RescheduleOccurrenceResolution,
]);
/** Occurrence resolution value. */
export type OccurrenceResolution = z.infer<typeof OccurrenceResolution>;

/** Edit only one occurrence without changing its series revision. */
export const OccurrenceSeriesEdit = z
  .object({
    scope: z.literal('occurrence'),
    scheduledFor: z.iso.date(),
    resolution: OccurrenceResolution,
  })
  .strict();
/** Single-occurrence edit value. */
export type OccurrenceSeriesEdit = z.infer<typeof OccurrenceSeriesEdit>;

/** Replace a series trigger from an effective date while preserving its past. */
export const FutureSeriesEdit = z
  .object({ scope: z.literal('future'), effectiveFrom: z.iso.date(), trigger: ProcessTrigger })
  .strict();
/** Future series edit value. */
export type FutureSeriesEdit = z.infer<typeof FutureSeriesEdit>;

/** A series edit, explicitly scoped to one occurrence or this-and-future. */
export const SeriesEdit = z.discriminatedUnion('scope', [OccurrenceSeriesEdit, FutureSeriesEdit]);
/** Series edit value. */
export type SeriesEdit = z.infer<typeof SeriesEdit>;

/** Lifecycle state of a recurrence series. */
export const RecurrenceSeriesStatus = z.enum(['active', 'paused', 'ended']);
/** Recurrence-series status value. */
export type RecurrenceSeriesStatus = z.infer<typeof RecurrenceSeriesStatus>;

/** Create a recurrence series over the current published revision of a process. */
export const RecurrenceSeriesCreate = z
  .object({
    processDefinitionId: ProcessDefinitionId,
    name: z.string().min(1),
    trigger: ProcessTrigger,
    effectiveFrom: z.iso.date().optional(),
  })
  .strict();
/** Recurrence-series create value. */
export type RecurrenceSeriesCreate = z.infer<typeof RecurrenceSeriesCreate>;

/** Pause materialization without changing the immutable trigger history. */
export const PauseRecurrenceSeries = z.object({ action: z.literal('pause') }).strict();
/** Pause-series command value. */
export type PauseRecurrenceSeries = z.infer<typeof PauseRecurrenceSeries>;

/** Resume future materialization from the current series revision. */
export const ResumeRecurrenceSeries = z.object({ action: z.literal('resume') }).strict();
/** Resume-series command value. */
export type ResumeRecurrenceSeries = z.infer<typeof ResumeRecurrenceSeries>;

/** Permanently end a series while preserving all historical occurrences. */
export const EndRecurrenceSeries = z.object({ action: z.literal('end') }).strict();
/** End-series command value. */
export type EndRecurrenceSeries = z.infer<typeof EndRecurrenceSeries>;

/** Explicit lifecycle transition for one recurrence series. */
export const RecurrenceSeriesLifecycle = z.discriminatedUnion('action', [
  PauseRecurrenceSeries,
  ResumeRecurrenceSeries,
  EndRecurrenceSeries,
]);
/** Recurrence-series lifecycle command value. */
export type RecurrenceSeriesLifecycle = z.infer<typeof RecurrenceSeriesLifecycle>;

/** Request to materialize one manual or explicitly dated series occurrence. */
export const MaterializeSeriesOccurrence = z
  .object({
    scheduledFor: z.iso.date().optional(),
    occurrenceKey: z.string().min(1).max(300).optional(),
  })
  .strict();
/** Series-materialization request value. */
export type MaterializeSeriesOccurrence = z.infer<typeof MaterializeSeriesOccurrence>;

/** Lifecycle state of one expected occurrence. */
export const OccurrenceStatus = z.enum([
  'expected',
  'materialized',
  'completed',
  'skipped',
  'canceled',
  'needs_resolution',
  'superseded',
]);
/** Occurrence status value. */
export type OccurrenceStatus = z.infer<typeof OccurrenceStatus>;

/** Public recurrence-series representation. */
export const RecurrenceSeriesOut = z.object({
  id: RecurrenceSeriesId,
  organizationId: OrganizationId,
  processDefinitionId: ProcessDefinitionId,
  processRevisionId: ProcessRevisionId,
  name: z.string(),
  status: RecurrenceSeriesStatus,
  trigger: ProcessTrigger,
  createdAt: z.string(),
  updatedAt: z.string(),
  pausedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});
/** Recurrence-series output value. */
export type RecurrenceSeriesOut = z.infer<typeof RecurrenceSeriesOut>;

/** One immutable trigger revision in a recurrence series' schedule history. */
export const RecurrenceSeriesRevisionOut = z
  .object({
    id: RecurrenceSeriesRevisionId,
    seriesId: RecurrenceSeriesId,
    processRevisionId: ProcessRevisionId,
    number: z.number().int().positive(),
    effectiveFrom: z.iso.date(),
    trigger: ProcessTrigger,
    createdAt: z.string(),
  })
  .strict();
/** Recurrence-series trigger revision output value. */
export type RecurrenceSeriesRevisionOut = z.infer<typeof RecurrenceSeriesRevisionOut>;

/** Bind one visible calendar event (or its provider series) to a reusable Docket process. */
export const CalendarProcessBindingCreate = z
  .object({
    calendarItemId: CalendarItemId,
    processDefinitionId: ProcessDefinitionId,
  })
  .strict();
/** Calendar-process binding create value. */
export type CalendarProcessBindingCreate = z.infer<typeof CalendarProcessBindingCreate>;

/** Whether a calendar binding follows one provider series or only one standalone event. */
export const CalendarProcessBindingScope = z.enum(['event_series', 'single_event']);
/** Calendar-process binding scope value. */
export type CalendarProcessBindingScope = z.infer<typeof CalendarProcessBindingScope>;

/** Public binding from calendar time to the recurrence series that creates its work. */
export const CalendarProcessBindingOut = z
  .object({
    id: z.string().min(1),
    organizationId: OrganizationId,
    calendarItemId: CalendarItemId,
    calendarLayerId: CalendarLayerId,
    externalSeriesId: z.string().min(1),
    scope: CalendarProcessBindingScope,
    processDefinitionId: ProcessDefinitionId,
    recurrenceSeriesId: RecurrenceSeriesId,
    seriesName: z.string().min(1),
    createdAt: z.string(),
  })
  .strict();
/** Calendar-process binding output value. */
export type CalendarProcessBindingOut = z.infer<typeof CalendarProcessBindingOut>;

/** Public occurrence representation. */
export const OccurrenceOut = z.object({
  id: OccurrenceId,
  seriesId: RecurrenceSeriesId,
  scheduledFor: z.iso.date(),
  originalScheduledFor: z.iso.date().nullable(),
  status: OccurrenceStatus,
  processInstanceId: ProcessInstanceId.nullable(),
  taskId: TaskId.nullable(),
  resolvedAt: z.string().nullable(),
});
/** Occurrence output value. */
export type OccurrenceOut = z.infer<typeof OccurrenceOut>;

/** Series detail with occurrence history and the currently materialized planning window. */
export const RecurrenceSeriesDetailOut = RecurrenceSeriesOut.extend({
  revisions: z.array(RecurrenceSeriesRevisionOut),
  occurrences: z.array(OccurrenceOut),
}).strict();
/** Recurrence-series detail output value. */
export type RecurrenceSeriesDetailOut = z.infer<typeof RecurrenceSeriesDetailOut>;

/** Recurrence provenance shared by generated tasks and projects. */
const GeneratedWorkRecurrenceFields = {
  seriesId: RecurrenceSeriesId,
  seriesName: z.string(),
  seriesStatus: RecurrenceSeriesStatus,
  processDefinitionId: ProcessDefinitionId,
  processInstanceId: ProcessInstanceId,
  occurrenceId: OccurrenceId,
  scheduledFor: z.iso.date(),
  occurrenceStatus: OccurrenceStatus,
} as const;

/** Backlink context for one ordinary task generated by a process occurrence. */
export const GeneratedTaskRecurrenceOut = z
  .object({ kind: z.literal('task'), taskId: TaskId, ...GeneratedWorkRecurrenceFields })
  .strict();
/** Generated-task recurrence backlink value. */
export type GeneratedTaskRecurrenceOut = z.infer<typeof GeneratedTaskRecurrenceOut>;

/** Backlink context for one ordinary project generated by a process occurrence. */
export const GeneratedProjectRecurrenceOut = z
  .object({ kind: z.literal('project'), projectId: ProjectId, ...GeneratedWorkRecurrenceFields })
  .strict();
/** Generated-project recurrence backlink value. */
export type GeneratedProjectRecurrenceOut = z.infer<typeof GeneratedProjectRecurrenceOut>;

/** Discriminated recurrence backlink for ordinary generated work. */
export const GeneratedWorkRecurrenceOut = z.discriminatedUnion('kind', [
  GeneratedTaskRecurrenceOut,
  GeneratedProjectRecurrenceOut,
]);
/** Generated-work recurrence backlink value. */
export type GeneratedWorkRecurrenceOut = z.infer<typeof GeneratedWorkRecurrenceOut>;

/** Result of creating and initially materializing a repeating task. */
export const RecurringTaskCreated = z.object({
  series: RecurrenceSeriesOut,
  firstTask: TaskOut,
  occurrences: z.array(OccurrenceOut),
});
/** Recurring-task creation result. */
export type RecurringTaskCreated = z.infer<typeof RecurringTaskCreated>;
