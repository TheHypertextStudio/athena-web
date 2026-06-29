/**
 * `@docket/types` — Task slice DTOs.
 */
import { z } from 'zod';

import { Priority } from './capability';
import {
  ActorId,
  CycleId,
  LabelId,
  MilestoneId,
  OrganizationId,
  ProgramId,
  ProjectId,
  TaskId,
  TeamId,
} from './primitives';

/** Body for creating a Task; `state` defaults to the team's first workflow state. */
export const TaskCreate = z
  .object({
    title: z.string().min(1),
    description: z.string().optional(),
    teamId: TeamId,
    state: z.string().optional(),
    priority: Priority.optional(),
    assigneeId: ActorId.optional(),
    projectId: ProjectId.optional(),
    milestoneId: MilestoneId.optional(),
    cycleId: CycleId.optional(),
    parentTaskId: TaskId.optional(),
    estimate: z.number().int().optional(),
    estimateMinutes: z.number().int().nullable().optional(),
    startDate: z.iso.date().optional(),
    dueDate: z.iso.date().optional(),
    labels: z.array(LabelId).optional(),
  })
  .meta({ id: 'TaskCreate', description: 'Create a task within an organization.' });
/** Validated task-create body. */
export type TaskCreate = z.infer<typeof TaskCreate>;

/** A Task's single inline provenance triple (native vs linked-from-an-integration). */
export const TaskProvenance = z
  .object({
    source: z.enum(['native', 'linked']),
    sourceIntegrationId: z.string().nullable().optional(),
    externalId: z.string().nullable().optional(),
    externalUrl: z.string().nullable().optional(),
    syncMode: z.enum(['import', 'mirror']).nullable().optional(),
  })
  .meta({ id: 'TaskProvenance', description: "A task's provenance." });
/** Task provenance value. */
export type TaskProvenance = z.infer<typeof TaskProvenance>;

/** Full task representation returned by reads. */
export const TaskOut = z
  .object({
    id: TaskId,
    organizationId: OrganizationId,
    title: z.string(),
    description: z.string().nullable().optional(),
    teamId: TeamId,
    state: z.string(),
    priority: Priority,
    assigneeId: ActorId.nullable().optional(),
    delegateId: ActorId.nullable().optional(),
    projectId: ProjectId.nullable().optional(),
    programId: ProgramId.nullable().optional(),
    estimateMinutes: z.number().int().nullable().optional(),
    startDate: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    provenance: TaskProvenance,
    createdAt: z.string(),
  })
  .meta({ id: 'TaskOut', description: 'A task.' });
/** Task representation value. */
export type TaskOut = z.infer<typeof TaskOut>;

/** Body for updating a Task (reparenting goes through `/move`, not here). */
export const TaskUpdate = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    state: z.string().optional(),
    priority: Priority.optional(),
    assigneeId: ActorId.nullable().optional(),
    delegateId: ActorId.nullable().optional(),
    projectId: ProjectId.nullable().optional(),
    programId: ProgramId.nullable().optional(),
    milestoneId: MilestoneId.nullable().optional(),
    cycleId: CycleId.nullable().optional(),
    estimate: z.number().int().optional(),
    estimateMinutes: z.number().int().nullable().optional(),
    startDate: z.iso.date().nullable().optional(),
    dueDate: z.iso.date().nullable().optional(),
    labels: z.array(LabelId).optional(),
  })
  .meta({ id: 'TaskUpdate', description: 'Update a task.' });
/** Validated task-update body. */
export type TaskUpdate = z.infer<typeof TaskUpdate>;

/** Body for changing a Task's workflow state; the key must exist in the team's `workflow_states`. */
export const TaskStateUpdate = z
  .object({
    state: z.string().min(1),
  })
  .meta({ id: 'TaskStateUpdate', description: "Set a task's workflow state." });
/** Validated task-state-change body. */
export type TaskStateUpdate = z.infer<typeof TaskStateUpdate>;

/** Body for creating a subtask under a parent Task (`parentTaskId` is taken from the path). */
export const SubtaskCreate = z
  .object({
    title: z.string().min(1),
    description: z.string().optional(),
    state: z.string().optional(),
    priority: Priority.optional(),
    assigneeId: ActorId.optional(),
    projectId: ProjectId.optional(),
    milestoneId: MilestoneId.optional(),
    cycleId: CycleId.optional(),
    estimate: z.number().int().optional(),
    estimateMinutes: z.number().int().nullable().optional(),
    startDate: z.iso.date().optional(),
    dueDate: z.iso.date().optional(),
    labels: z.array(LabelId).optional(),
  })
  .meta({ id: 'SubtaskCreate', description: 'Create a subtask under a parent task.' });
/** Validated subtask-create body. */
export type SubtaskCreate = z.infer<typeof SubtaskCreate>;

/** A lightweight Task reference carrying its project for cross-project dependency display. */
export const TaskRef = z
  .object({
    id: TaskId,
    title: z.string(),
    state: z.string(),
    projectId: ProjectId.nullable().optional(),
  })
  .meta({ id: 'TaskRef', description: 'A task reference with its project.' });
/** Task reference value. */
export type TaskRef = z.infer<typeof TaskRef>;

/**
 * The richer single-task read: the full task plus its dependency edges and subtasks.
 *
 * @remarks
 * `blocking` are tasks this task blocks; `blockedBy` are tasks blocking this one.
 * Each ref carries its `projectId` so the UI can show cross-project links.
 */
export const TaskDetail = TaskOut.extend({
  milestoneId: MilestoneId.nullable().optional(),
  cycleId: CycleId.nullable().optional(),
  parentTaskId: TaskId.nullable().optional(),
  estimate: z.number().int().nullable().optional(),
  estimateMinutes: z.number().int().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  canceledAt: z.string().nullable().optional(),
  blocking: z.array(TaskRef),
  blockedBy: z.array(TaskRef),
  subtasks: z.array(TaskRef),
}).meta({ id: 'TaskDetail', description: 'A task with its dependencies and subtasks.' });
/** Detailed task representation value. */
export type TaskDetail = z.infer<typeof TaskDetail>;

/**
 * Body for adding a dependency edge to a Task.
 *
 * @remarks
 * Exactly one of `blockingTaskId` / `blockedTaskId` is given relative to the path
 * task: `blockingTaskId` makes the given task block the path task; `blockedTaskId`
 * makes the path task block the given task. Both express the same directed `blocks`
 * graph (blocking → blocked).
 */
export const TaskDependencyCreate = z
  .object({
    blockingTaskId: TaskId.optional(),
    blockedTaskId: TaskId.optional(),
  })
  .refine((v) => (v.blockingTaskId === undefined) !== (v.blockedTaskId === undefined), {
    message: 'Provide exactly one of blockingTaskId or blockedTaskId',
  })
  .meta({ id: 'TaskDependencyCreate', description: 'Add a directed dependency edge.' });
/** Validated dependency-create body. */
export type TaskDependencyCreate = z.infer<typeof TaskDependencyCreate>;

/** A Task's two dependency lists; each ref carries its project for cross-project display. */
export const TaskDependencyOut = z
  .object({
    blocking: z.array(TaskRef),
    blockedBy: z.array(TaskRef),
  })
  .meta({ id: 'TaskDependencyOut', description: "A task's dependency edges." });
/** Task dependency lists value. */
export type TaskDependencyOut = z.infer<typeof TaskDependencyOut>;

/** Acknowledgement returned when a dependency edge is created. */
export const TaskDependencyCreated = z
  .object({
    created: z.literal(true),
    blockingTaskId: TaskId,
    blockedTaskId: TaskId,
  })
  .meta({ id: 'TaskDependencyCreated', description: 'A created dependency edge.' });
/** Created-dependency acknowledgement value. */
export type TaskDependencyCreated = z.infer<typeof TaskDependencyCreated>;

/** Acknowledgement returned when a dependency edge is removed. */
export const TaskRemoved = z
  .object({
    removed: z.literal(true),
  })
  .meta({ id: 'TaskRemoved', description: 'A removed edge acknowledgement.' });
/** Removal acknowledgement value. */
export type TaskRemoved = z.infer<typeof TaskRemoved>;

/** Acknowledgement returned when a Task is archived (soft-deleted). */
export const TaskArchived = z
  .object({
    id: TaskId,
    archivedAt: z.string(),
  })
  .meta({ id: 'TaskArchived', description: 'An archived task acknowledgement.' });
/** Archived-task acknowledgement value. */
export type TaskArchived = z.infer<typeof TaskArchived>;
