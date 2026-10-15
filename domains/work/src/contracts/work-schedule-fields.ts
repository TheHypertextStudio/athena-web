import { ActorId, TeamId } from '@docket/identity-access/ids';
import { z } from 'zod';
import { CycleId, InitiativeId, LabelId, MilestoneId, ProgramId, ProjectId, TaskId } from '../ids';
import { TaskCreate, checkTaskDates } from './task';
import {
  BlueprintCivilDate,
  BlueprintMilestoneFields,
  BlueprintProgramFields,
  BlueprintProjectFields,
  BlueprintTaskFields,
  StepKey,
} from './work-template-blueprint';

const date = BlueprintCivilDate.nullable().optional();
const assignment = {
  teamId: TeamId.nullable().optional(),
  responsibleActorId: ActorId.nullable().optional(),
};
const taskFields = BlueprintTaskFields.partial().extend({
  summary: BlueprintTaskFields.shape.summary.nullable(),
  estimate: TaskCreate.shape.estimate,
  estimateMinutes: TaskCreate.shape.estimateMinutes,
});
const projectFields = BlueprintProjectFields.partial().extend({
  summary: BlueprintProjectFields.shape.summary.nullable(),
  health: BlueprintProjectFields.shape.health.nullable(),
  labelIds: z.array(LabelId).optional(),
});
const programFields = BlueprintProgramFields.partial().extend({
  summary: BlueprintProgramFields.shape.summary.nullable(),
  health: BlueprintProgramFields.shape.health.nullable(),
});
const taskDates = z.strictObject({ startDate: date, dueDate: date }).superRefine(checkTaskDates);
const projectDates = z
  .strictObject({ startDate: date, targetDate: date })
  .superRefine((value, ctx) => {
    checkTaskDates({ startDate: value.startDate, dueDate: value.targetDate }, ctx);
  });
const taskPlacement = z.strictObject({
  projectId: ProjectId.nullable().optional(),
  milestoneId: MilestoneId.nullable().optional(),
  parentTaskId: TaskId.nullable().optional(),
});
const projectPlacement = z.strictObject({
  programId: ProgramId.nullable().optional(),
  initiativeIds: z.array(InitiativeId).optional(),
});
const task = {
  kind: z.literal('task'),
  fields: taskFields,
  dates: taskDates,
  ...assignment,
  cycleId: CycleId.nullable().optional(),
};
const project = {
  kind: z.literal('project'),
  fields: projectFields,
  dates: projectDates,
  ...assignment,
};
/** Private ordinary root overrides; the owning Program and live destinations are checked by creation preflight. */
export const WorkScheduleRootDraft = z.discriminatedUnion('kind', [
  z.strictObject({ ...task, placement: taskPlacement }),
  z.strictObject({ ...project, placement: projectPlacement }),
]);
/** Kind-correlated private root overrides, preserving omission and explicit unassigned/null choices. */
export type WorkScheduleRootDraft = z.infer<typeof WorkScheduleRootDraft>;
const path = z.array(StepKey).min(1).max(499);
/** Location-specific overrides for existing authored paths; identity, structure and provenance cannot be replaced. */
export const WorkScheduleStepOverride = z.discriminatedUnion('kind', [
  z.strictObject({ ...task, path, fields: taskFields.optional(), dates: taskDates.optional() }),
  z.strictObject({
    ...project,
    path,
    fields: projectFields.optional(),
    dates: projectDates.optional(),
  }),
  z.strictObject({
    kind: z.literal('program'),
    path,
    fields: programFields.optional(),
    ...assignment,
  }),
  z.strictObject({
    kind: z.literal('milestone'),
    path,
    fields: BlueprintMilestoneFields.partial().optional(),
    dates: z.strictObject({ targetDate: date }).optional(),
  }),
]);
/** Private path override value; supported fields remain correlated with the authored kind. */
export type WorkScheduleStepOverride = z.infer<typeof WorkScheduleStepOverride>;
