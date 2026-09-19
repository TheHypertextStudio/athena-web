/**
 * `domain packages` — the step specifications a reusable process revision is built from.
 *
 * @remarks
 * Split out of `./recurrence` so the schedule contracts and the process-authoring contracts each
 * read as one subject. `./recurrence` re-exports everything here, so callers import from either.
 * Every cross-step reference is validated here rather than at write time: a revision is immutable
 * once created, so a specification that names a step it does not contain can never be repaired.
 */
import { z } from 'zod';

import { ActorId, TeamId } from '@docket/identity-access/ids';
import { CycleId, LabelId, MilestoneId, ProgramId, ProjectId, TaskId } from '@docket/work/ids';
import { Health } from '@docket/work/capability-contract';
import { Priority } from '@docket/work/task-contract';

import { ProjectStatus } from './project';

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
