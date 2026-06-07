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
    estimate: z.number().int().optional(),
    dueDate: z.iso.date().optional(),
    labels: z.array(LabelId).optional(),
  })
  .meta({ id: 'TaskUpdate', description: 'Update a task.' });
/** Validated task-update body. */
export type TaskUpdate = z.infer<typeof TaskUpdate>;
