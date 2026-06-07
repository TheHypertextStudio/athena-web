/**
 * `@docket/types` — Project slice DTOs.
 */
import { z } from 'zod';

import { Health } from './capability';
import { ActorId, InitiativeId, OrganizationId, ProgramId, ProjectId, TeamId } from './primitives';

/** Body for creating a Project (organizationId comes from the path, never the body). */
export const ProjectCreate = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    leadId: ActorId.optional(),
    teamId: TeamId.optional(),
    startDate: z.iso.date().optional(),
    targetDate: z.iso.date().optional(),
    initiativeIds: z.array(InitiativeId).optional(),
  })
  .meta({ id: 'ProjectCreate', description: 'Create a project within an organization.' });
/** Validated project-create body. */
export type ProjectCreate = z.infer<typeof ProjectCreate>;

/**
 * A Project's lifecycle status.
 *
 * @remarks
 * Mirrors the `project_status` Postgres enum (data-model §4): a bounded effort moves
 * `planned → active → completed`, or is `canceled`.
 */
export const ProjectStatus = z.enum(['planned', 'active', 'completed', 'canceled']);
/** Project lifecycle status value. */
export type ProjectStatus = z.infer<typeof ProjectStatus>;

/**
 * Body for partially updating a Project (organizationId comes from the path, never the body).
 *
 * @remarks
 * Every field is optional: an absent key leaves that column untouched, while `null`
 * (where allowed) clears a nullable column. Capability `contribute` per the API contract.
 */
export const ProjectUpdate = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    leadId: ActorId.nullable().optional(),
    programId: ProgramId.nullable().optional(),
    teamId: TeamId.nullable().optional(),
    status: ProjectStatus.optional(),
    health: Health.nullable().optional(),
    startDate: z.iso.date().nullable().optional(),
    targetDate: z.iso.date().nullable().optional(),
  })
  .meta({ id: 'ProjectUpdate', description: 'Partially update a project.' });
/** Validated project-update body. */
export type ProjectUpdate = z.infer<typeof ProjectUpdate>;

/** Full project representation returned by reads. */
export const ProjectOut = z
  .object({
    id: ProjectId,
    organizationId: OrganizationId,
    name: z.string(),
    description: z.string().nullable().optional(),
    status: z.string(),
    health: Health.nullable().optional(),
    leadId: ActorId.nullable().optional(),
    teamId: TeamId.nullable().optional(),
    programId: ProgramId.nullable().optional(),
    startDate: z.string().nullable().optional(),
    targetDate: z.string().nullable().optional(),
    createdAt: z.string(),
  })
  .meta({ id: 'ProjectOut', description: 'A project.' });
/** Project representation value. */
export type ProjectOut = z.infer<typeof ProjectOut>;

/**
 * Weighted completion roll-up across a Project's Tasks.
 *
 * @remarks
 * `percent` is `completedWeight / totalWeight` (0 when there is no work). Weight is the
 * sum of Task estimates when estimates are present; when no Task carries an estimate the
 * roll-up falls back to a plain Task **count** so each Task weighs `1`. `taskCount` /
 * `completedCount` are always the raw row counts regardless of which weighting applies.
 */
export const ProjectProgress = z
  .object({
    /** Completion ratio in `[0, 1]` (`completedWeight / totalWeight`; `0` when no tasks). */
    percent: z.number().min(0).max(1),
    /** Summed weight of completed tasks (estimate sum, or completed count in count mode). */
    completedWeight: z.number().min(0),
    /** Summed weight of all tasks (estimate sum, or total count in count mode). */
    totalWeight: z.number().min(0),
    /** Raw number of tasks in the project. */
    taskCount: z.number().int().min(0),
    /** Raw number of completed tasks in the project. */
    completedCount: z.number().int().min(0),
  })
  .meta({ id: 'ProjectProgress', description: 'Weighted completion roll-up for a project.' });
/** Weighted project-progress value. */
export type ProjectProgress = z.infer<typeof ProjectProgress>;
