/**
 * `@docket/types` — Program slice DTOs.
 */
import { z } from 'zod';

import { Health, Visibility } from './capability';
import { CycleId, OrganizationId, ProjectId, ActorId, ProgramId } from './primitives';
import { TaskOut } from './task';

/** Program status — Programs are ongoing, so there is intentionally NO `completed`. */
export const ProgramStatus = z
  .enum(['active', 'paused', 'archived'])
  .describe(
    'Program lifecycle status. `active` = running operation; `paused` = temporarily on hold; `archived` = retired but retained for history. There is intentionally NO `completed` — operational programs never "finish".',
  );
/** Program status value. */
export type ProgramStatus = z.infer<typeof ProgramStatus>;

/** Body for creating a Program (organizationId comes from the path, never the body). */
export const ProgramCreate = z
  .object({
    name: z.string().min(1).describe('Human-readable program name. Required, non-empty.'),
    description: z
      .string()
      .optional()
      .describe('Optional free-text description of the program’s mission/scope.'),
    summary: z
      .string()
      .max(280)
      .optional()
      .describe('Optional plain-text summary, limited to 280 characters.'),
    ownerId: ActorId.optional().describe(
      'Optional owning Actor (the accountable person). Must reference an Actor in the caller’s org.',
    ),
    status: ProgramStatus.optional().describe('Initial status. Defaults to `active` when omitted.'),
    health: Health.optional().describe(
      'Optional initial health verdict (`on_track`/`at_risk`/`off_track`). Omit to leave unset (no verdict yet).',
    ),
    visibility: Visibility.optional().describe(
      'Access scope. Defaults to `public` (visible to all org members) when omitted; `private` restricts the program to actors with an explicit grant.',
    ),
  })
  .meta({ id: 'ProgramCreate', description: 'Create a program within an organization.' });
/** Validated program-create body. */
export type ProgramCreate = z.infer<typeof ProgramCreate>;

/** Body for updating a Program (all fields optional). */
export const ProgramUpdate = z
  .object({
    name: z
      .string()
      .min(1)
      .optional()
      .describe('New program name. Omit to leave unchanged; must be non-empty when set.'),
    description: z
      .string()
      .nullable()
      .optional()
      .describe('New description. Omit to leave unchanged; pass `null` to clear it.'),
    summary: z
      .string()
      .max(280)
      .optional()
      .describe('New plain-text summary. Omit to leave unchanged; send an empty string to clear.'),
    ownerId: ActorId.nullable()
      .optional()
      .describe(
        'Re-point the owning Actor (must be in the caller’s org). Omit to leave unchanged; pass `null` to clear the owner.',
      ),
    status: ProgramStatus.optional().describe(
      'New status (`active`/`paused`/`archived` only — never `completed`). Omit to leave unchanged.',
    ),
    health: Health.nullable()
      .optional()
      .describe('New health verdict. Omit to leave unchanged; pass `null` to clear the verdict.'),
    visibility: Visibility.optional().describe(
      'Flip between `public` (org-wide) and `private` (grant-only). Omit to leave unchanged.',
    ),
  })
  .meta({ id: 'ProgramUpdate', description: 'Update a program.' });
/** Validated program-update body. */
export type ProgramUpdate = z.infer<typeof ProgramUpdate>;

/** Full program representation returned by reads. */
export const ProgramOut = z
  .object({
    id: ProgramId.describe('Stable unique identifier of the program.'),
    organizationId: OrganizationId.describe('The owning organization (tenant).'),
    name: z.string().describe('Human-readable program name.'),
    description: z
      .string()
      .nullable()
      .optional()
      .describe('Free-text description, or `null`/absent when none.'),
    summary: z.string().nullable().describe('Plain-text summary, or `null` when none.'),
    ownerId: ActorId.nullable()
      .optional()
      .describe('The owning Actor (accountable person), or `null` when unowned.'),
    status: ProgramStatus.describe('Current lifecycle status (`active`/`paused`/`archived`).'),
    health: Health.nullable()
      .optional()
      .describe('Current health verdict (`on_track`/`at_risk`/`off_track`), or `null` when unset.'),
    visibility: Visibility.describe(
      'Access scope: `public` (all org members) or `private` (grant-only).',
    ),
    createdAt: z.string().describe('When the program was created (ISO-8601 timestamp).'),
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
    projects: z
      .number()
      .int()
      .min(0)
      .describe('Number of Projects whose `program_id` is this Program.'),
    tasks: z
      .number()
      .int()
      .min(0)
      .describe(
        'Number of active (non-archived) Tasks under this Program — attached directly via `task.program_id` OR belonging to one of the Program’s Projects (the union, de-duplicated).',
      ),
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
  rollup: ProgramRollup.describe(
    'Counts of the Projects and active Tasks contained by this Program, for an at-a-glance scope read.',
  ),
}).meta({ id: 'ProgramDetail', description: 'A program with its child-work roll-up.' });
/** Detailed program representation value. */
export type ProgramDetail = z.infer<typeof ProgramDetail>;

/** A lightweight Cycle reference for grouping a Program's work by cadence. */
export const ProgramCycleRef = z
  .object({
    id: CycleId.nullable().describe(
      'The cycle id, or `null` for the "no cycle" group (unscheduled tasks).',
    ),
    name: z
      .string()
      .nullable()
      .optional()
      .describe('The cycle’s display name, when it has one (cycles may be unnamed).'),
    number: z
      .number()
      .int()
      .nullable()
      .optional()
      .describe(
        'The cycle’s team-local sequence number, present only when grouped under a real cycle.',
      ),
  })
  .meta({ id: 'ProgramCycleRef', description: 'A cycle reference within a program work view.' });
/** Program cycle-reference value. */
export type ProgramCycleRef = z.infer<typeof ProgramCycleRef>;

/** A lightweight Project reference for segmenting a Program's work by project. */
export const ProgramProjectRef = z
  .object({
    id: ProjectId.nullable().describe(
      'The project id, or `null` for the "no project" segment (tasks attached straight to the Program).',
    ),
    name: z
      .string()
      .nullable()
      .optional()
      .describe('The project’s display name, present when segmented under a real project.'),
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
    project: ProgramProjectRef.describe(
      'The project this segment’s tasks belong to (or the "no project" sentinel).',
    ),
    tasks: z
      .array(TaskOut)
      .describe('The tasks in this project within the enclosing cycle group, newest-first.'),
  })
  .meta({ id: 'ProgramWorkSegment', description: 'A project segment of a program work group.' });
/** Program work-segment value. */
export type ProgramWorkSegment = z.infer<typeof ProgramWorkSegment>;

/** One cycle-group of a Program work view: a cycle plus its project segments. */
export const ProgramWorkGroup = z
  .object({
    cycle: ProgramCycleRef.describe(
      'The cycle this group’s work falls in (or the "no cycle" sentinel).',
    ),
    segments: z
      .array(ProgramWorkSegment)
      .describe('The per-project segments of work within this cycle.'),
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
    groups: z
      .array(ProgramWorkGroup)
      .describe(
        'The cycle groups (including a `null`-cycle group for unscheduled tasks), each carrying its per-project segments.',
      ),
  })
  .meta({ id: 'ProgramWorkOut', description: "A program's work grouped by cycle, by project." });
/** Program work-view value. */
export type ProgramWorkOut = z.infer<typeof ProgramWorkOut>;

/** Query filters for narrowing a Program's work view to a cycle and/or project. */
export const ProgramWorkQuery = z
  .object({
    cycleId: CycleId.optional().describe(
      'Restrict the work view to a single cycle’s tasks. Omit for all cycles.',
    ),
    projectId: ProjectId.optional().describe(
      'Restrict the work view to a single project’s tasks. Omit for all projects.',
    ),
  })
  .meta({ id: 'ProgramWorkQuery', description: "Filters for a program's work view." });
/** Validated program-work query value. */
export type ProgramWorkQuery = z.infer<typeof ProgramWorkQuery>;
