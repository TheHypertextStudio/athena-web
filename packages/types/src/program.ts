/**
 * `@docket/types` — Program slice DTOs.
 */
import { z } from 'zod';

import { Health, Visibility } from './capability';
import { CycleId, OrganizationId, ProjectId, ActorId, ProgramId } from './primitives';
import { TaskOut } from './task';

/** Program status — Programs are ongoing, so there is intentionally NO `completed`. */
export const ProgramStatus = z.enum(['active', 'paused', 'archived']);
/** Program status value. */
export type ProgramStatus = z.infer<typeof ProgramStatus>;

/** Body for creating a Program (organizationId comes from the path, never the body). */
export const ProgramCreate = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    ownerId: ActorId.optional(),
    status: ProgramStatus.optional(),
    health: Health.optional(),
    visibility: Visibility.optional(),
  })
  .meta({ id: 'ProgramCreate', description: 'Create a program within an organization.' });
/** Validated program-create body. */
export type ProgramCreate = z.infer<typeof ProgramCreate>;

/** Body for updating a Program (all fields optional). */
export const ProgramUpdate = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    ownerId: ActorId.nullable().optional(),
    status: ProgramStatus.optional(),
    health: Health.nullable().optional(),
    visibility: Visibility.optional(),
  })
  .meta({ id: 'ProgramUpdate', description: 'Update a program.' });
/** Validated program-update body. */
export type ProgramUpdate = z.infer<typeof ProgramUpdate>;

/** Full program representation returned by reads. */
export const ProgramOut = z
  .object({
    id: ProgramId,
    organizationId: OrganizationId,
    name: z.string(),
    description: z.string().nullable().optional(),
    ownerId: ActorId.nullable().optional(),
    status: ProgramStatus,
    health: Health.nullable().optional(),
    visibility: Visibility,
    createdAt: z.string(),
  })
  .meta({ id: 'ProgramOut', description: 'A program.' });
/** Program representation value. */
export type ProgramOut = z.infer<typeof ProgramOut>;

/**
 * A Program's child-work roll-up: how many Projects and Tasks live under it.
 *
 * @remarks
 * Both Projects (`project.program_id`) and Tasks (`task.program_id`, plus tasks whose
 * project belongs to the Program) hang off a Program (data-model §4.2–4.4). `taskCount`
 * counts every active (non-archived) task under the Program — whether attached directly
 * or via one of the Program's Projects — so a Program detail card can show its scope at
 * a glance without a second round-trip.
 */
export const ProgramRollup = z
  .object({
    /** Number of Projects whose `program_id` is this Program. */
    projects: z.number().int().min(0),
    /** Number of active Tasks under this Program (directly or via its Projects). */
    tasks: z.number().int().min(0),
  })
  .meta({ id: 'ProgramRollup', description: "A program's child-work counts." });
/** Program child-work roll-up value. */
export type ProgramRollup = z.infer<typeof ProgramRollup>;

/**
 * The richer single-Program read: the full Program plus a roll-up of its child work.
 *
 * @remarks
 * Returned by `GET /programs/:programId`. Extends {@link ProgramOut} (so every consumer
 * of the plain shape keeps working) with a {@link ProgramRollup} count of the Projects
 * and active Tasks contained by the Program.
 */
export const ProgramDetail = ProgramOut.extend({
  /** Counts of the Projects and active Tasks contained by this Program. */
  rollup: ProgramRollup,
}).meta({ id: 'ProgramDetail', description: 'A program with its child-work roll-up.' });
/** Detailed program representation value. */
export type ProgramDetail = z.infer<typeof ProgramDetail>;

/** A lightweight Cycle reference for grouping a Program's work by cadence. */
export const ProgramCycleRef = z
  .object({
    /** The cycle id, or `null` for the "no cycle" group. */
    id: CycleId.nullable(),
    /** The cycle's display name, when it has one. */
    name: z.string().nullable().optional(),
    /** The cycle's sequence number within its team, when grouped under a real cycle. */
    number: z.number().int().nullable().optional(),
  })
  .meta({ id: 'ProgramCycleRef', description: 'A cycle reference within a program work view.' });
/** Program cycle-reference value. */
export type ProgramCycleRef = z.infer<typeof ProgramCycleRef>;

/** A lightweight Project reference for segmenting a Program's work by project. */
export const ProgramProjectRef = z
  .object({
    /** The project id, or `null` for the "no project" segment. */
    id: ProjectId.nullable(),
    /** The project's display name, when segmented under a real project. */
    name: z.string().nullable().optional(),
  })
  .meta({
    id: 'ProgramProjectRef',
    description: 'A project reference within a program work view.',
  });
/** Program project-reference value. */
export type ProgramProjectRef = z.infer<typeof ProgramProjectRef>;

/** One project-segment of a Program work group: a project plus its tasks. */
export const ProgramWorkSegment = z
  .object({
    /** The project this segment's tasks belong to (or the "no project" sentinel). */
    project: ProgramProjectRef,
    /** The tasks in this project within the enclosing cycle group. */
    tasks: z.array(TaskOut),
  })
  .meta({ id: 'ProgramWorkSegment', description: 'A project segment of a program work group.' });
/** Program work-segment value. */
export type ProgramWorkSegment = z.infer<typeof ProgramWorkSegment>;

/** One cycle-group of a Program work view: a cycle plus its project segments. */
export const ProgramWorkGroup = z
  .object({
    /** The cycle this group's work falls in (or the "no cycle" sentinel). */
    cycle: ProgramCycleRef,
    /** The per-project segments of work within this cycle. */
    segments: z.array(ProgramWorkSegment),
  })
  .meta({ id: 'ProgramWorkGroup', description: 'A cycle group of a program work view.' });
/** Program work-group value. */
export type ProgramWorkGroup = z.infer<typeof ProgramWorkGroup>;

/**
 * The work under a Program, grouped by Cycle and segmented by Project.
 *
 * @remarks
 * Returned by `GET /programs/:programId/work`. "Work under a Program" is every active
 * (non-archived) Task that either carries the Program's `program_id` directly or belongs
 * to a Project whose `program_id` is the Program (data-model §4.2–4.4). Tasks are first
 * grouped by their `cycle_id` (the "no cycle" group, keyed `null`, holds unscheduled
 * tasks), then within each group segmented by their `project_id` (the "no project"
 * segment, keyed `null`, holds tasks attached straight to the Program). Optional
 * `cycleId` / `projectId` query filters narrow the view to a single cadence/project.
 */
export const ProgramWorkOut = z
  .object({
    /** The cycle groups, each carrying its per-project segments. */
    groups: z.array(ProgramWorkGroup),
  })
  .meta({ id: 'ProgramWorkOut', description: "A program's work grouped by cycle, by project." });
/** Program work-view value. */
export type ProgramWorkOut = z.infer<typeof ProgramWorkOut>;

/** Query filters for narrowing a Program's work view to a cycle and/or project. */
export const ProgramWorkQuery = z
  .object({
    /** Restrict to a single cycle's work. */
    cycleId: CycleId.optional(),
    /** Restrict to a single project's work. */
    projectId: ProjectId.optional(),
  })
  .meta({ id: 'ProgramWorkQuery', description: "Filters for a program's work view." });
/** Validated program-work query value. */
export type ProgramWorkQuery = z.infer<typeof ProgramWorkQuery>;
