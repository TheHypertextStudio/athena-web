/**
 * `@docket/types` — Project slice DTOs.
 */
import { z } from 'zod';

import { SessionActivityOut } from './agent';
import { Health } from './capability';
import { EntityDisplayOut } from './entity-display';
import { LabelOut } from './label';
import {
  ActorId,
  AgentId,
  InitiativeId,
  LabelId,
  MilestoneId,
  OrganizationId,
  ProgramId,
  ProjectId,
  TaskId,
  TeamId,
} from './primitives';

/** Body for creating a Project (organizationId comes from the path, never the body). */
export const ProjectCreate = z
  .object({
    name: z.string().min(1).describe('Human-readable project name. Required, non-empty.'),
    summary: z
      .string()
      .max(280)
      .optional()
      .describe('Optional concise outcome summary, limited to 280 characters.'),
    description: z
      .string()
      .optional()
      .describe('Optional free-text description of the project’s goal/scope.'),
    leadId: ActorId.optional().describe(
      'Optional project lead (the accountable Actor). Must reference an Actor in the caller’s org (404 otherwise).',
    ),
    teamId: TeamId.optional().describe(
      'Optional owning Team. Must reference a Team in the caller’s org (404 otherwise).',
    ),
    startDate: z.iso
      .date()
      .optional()
      .describe(
        'Planned start date (ISO-8601 `YYYY-MM-DD`). Optional; positions the project’s bar on roadmaps.',
      ),
    targetDate: z.iso
      .date()
      .optional()
      .describe(
        'Planned completion/end date (ISO-8601 `YYYY-MM-DD`). Optional; the right edge of the project’s bar.',
      ),
    initiativeIds: z
      .array(InitiativeId)
      .optional()
      .describe(
        'Optional set of Initiative themes to associate at creation (writes `initiative_project` edges). Each id must live in the caller’s org (404 on any miss); duplicates are de-duplicated. Note `programId` is NOT accepted here — file the project under a Program later via PATCH.',
      ),
    labelIds: z
      .array(LabelId)
      .optional()
      .describe('Optional organization-global Labels to attach to the Project.'),
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
export const ProjectStatus = z
  .enum(['planned', 'active', 'completed', 'canceled'])
  .describe(
    'Project lifecycle status (mirrors the `project_status` Postgres enum). `planned` = scoped but not started; `active` = in progress; `completed` = finished successfully; `canceled` = abandoned. `completed` and `canceled` are the two terminal states (a Project is terminal for an Initiative’s derived-`completed` roll-up when in either).',
  );
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
    name: z
      .string()
      .min(1)
      .optional()
      .describe('New project name. Omit to leave unchanged; non-empty when set.'),
    summary: z
      .string()
      .max(280)
      .optional()
      .describe(
        'New concise outcome summary. Omit to leave unchanged; send an empty string to clear.',
      ),
    description: z
      .string()
      .optional()
      .describe('New description. Omit to leave unchanged; send an empty string to clear.'),
    leadId: ActorId.nullable()
      .optional()
      .describe(
        'Re-point the project lead (must be an Actor in the caller’s org). Omit to leave unchanged; `null` clears it.',
      ),
    programId: ProgramId.nullable()
      .optional()
      .describe(
        'File the project under a Program (must be a Program in the caller’s org), or `null` to unfile it. Omit to leave unchanged. This is the only way to set a project’s Program (it is not accepted on create).',
      ),
    teamId: TeamId.nullable()
      .optional()
      .describe(
        'Re-point the owning Team (must be a Team in the caller’s org). Omit to leave unchanged; `null` clears it.',
      ),
    status: ProjectStatus.optional().describe(
      'New lifecycle status (`planned`/`active`/`completed`/`canceled`). Including this emits a `status_change` observation. Omit to leave unchanged.',
    ),
    health: Health.nullable()
      .optional()
      .describe(
        'New health verdict (`on_track`/`at_risk`/`off_track`). Omit to leave unchanged; `null` clears it.',
      ),
    startDate: z.iso
      .date()
      .nullable()
      .optional()
      .describe(
        'New start date (ISO-8601 `YYYY-MM-DD`). Omit to leave unchanged; `null` clears it.',
      ),
    targetDate: z.iso
      .date()
      .nullable()
      .optional()
      .describe(
        'New target/end date (ISO-8601 `YYYY-MM-DD`). Omit to leave unchanged; `null` clears it.',
      ),
    labelIds: z
      .array(LabelId)
      .optional()
      .describe('Replace the Project’s organization-global Label associations when supplied.'),
  })
  .meta({ id: 'ProjectUpdate', description: 'Partially update a project.' });
/** Validated project-update body. */
export type ProjectUpdate = z.infer<typeof ProjectUpdate>;

/** URL resource attached to a Project's operating record. */
export const ProjectResourceCreate = z
  .object({
    title: z.string().min(1).describe('Human-readable resource title.'),
    url: z.url().describe('External URL referenced by the Project.'),
  })
  .meta({ id: 'ProjectResourceCreate', description: 'Attach a URL to a Project.' });
/** Validated Project resource body. */
export type ProjectResourceCreate = z.infer<typeof ProjectResourceCreate>;

/** Full project representation returned by reads. */
export const ProjectOut = z
  .object({
    id: ProjectId.describe('Stable unique identifier of the project.'),
    organizationId: OrganizationId.describe('The owning organization (tenant).'),
    name: z.string().describe('Human-readable project name.'),
    summary: z
      .string()
      .nullable()
      .optional()
      .describe('Concise outcome summary, or `null`/absent when none.'),
    description: z
      .string()
      .nullable()
      .optional()
      .describe('Free-text description, or `null`/absent when none.'),
    status: z
      .string()
      .describe(
        'Current lifecycle status — one of `planned`/`active`/`completed`/`canceled` (see {@link ProjectStatus}). Typed as a plain string on the wire; the enum captures the allowed values.',
      ),
    health: Health.nullable()
      .optional()
      .describe('Current health verdict (`on_track`/`at_risk`/`off_track`), or `null` when unset.'),
    leadId: ActorId.nullable()
      .optional()
      .describe('The accountable lead Actor, or `null` when unassigned.'),
    teamId: TeamId.nullable().describe('The owning Team, or `null` when none.'),
    programId: ProgramId.nullable()
      .optional()
      .describe('The Program this project is filed under, or `null` when unfiled.'),
    startDate: z
      .string()
      .nullable()
      .optional()
      .describe('Planned start date (ISO-8601 string), or `null` when unscheduled.'),
    targetDate: z
      .string()
      .nullable()
      .optional()
      .describe('Planned target/end date (ISO-8601 string), or `null` when unscheduled.'),
    createdAt: z.string().describe('When the project was created (ISO-8601 timestamp).'),
  })
  .meta({ id: 'ProjectOut', description: 'A project.' });
/** Project representation value. */
export type ProjectOut = z.infer<typeof ProjectOut>;

/** One Project row composed for the high-density portfolio overview. */
export const ProjectOverviewItem = ProjectOut.extend({
  display: EntityDisplayOut.describe(
    'Presentation-only icon and semantic color metadata kept outside the Project record.',
  ),
  taskCount: z.number().int().min(0).describe('Number of Tasks directly assigned to the Project.'),
  completedTaskCount: z
    .number()
    .int()
    .min(0)
    .describe('Number of directly assigned Tasks that have been completed.'),
  blockedByIds: z
    .array(ProjectId)
    .describe('Projects that must complete before this Project can proceed.'),
  blocksIds: z.array(ProjectId).describe('Projects whose progress depends on this Project.'),
}).meta({
  id: 'ProjectOverviewItem',
  description: 'A Project with display, task-progress, and dependency context for portfolio views.',
});
/** Project portfolio row value. */
export type ProjectOverviewItem = z.infer<typeof ProjectOverviewItem>;

/** Aggregate payload shared by list, dependency, and timeline Project lenses. */
export const ProjectOverviewOut = z
  .object({ items: z.array(ProjectOverviewItem) })
  .meta({ id: 'ProjectOverviewOut', description: 'Project portfolio overview aggregate.' });
/** Project portfolio aggregate value. */
export type ProjectOverviewOut = z.infer<typeof ProjectOverviewOut>;

/** A compact Project reference suitable for a dependency list. */
export const ProjectRef = z
  .object({
    id: ProjectId.describe('Stable id of the referenced Project.'),
    name: z.string().describe('Human-readable Project name.'),
    status: ProjectStatus.describe('Current Project lifecycle status.'),
    targetDate: z.string().nullable().describe('Target date when set, otherwise null.'),
  })
  .meta({ id: 'ProjectRef', description: 'A compact Project reference.' });
/** Compact Project dependency reference value. */
export type ProjectRef = z.infer<typeof ProjectRef>;

/** Body for creating a directed Project dependency relative to the path Project. */
export const ProjectDependencyCreate = z
  .object({
    blockingProjectId: ProjectId.optional().describe(
      'A Project that blocks the path Project. Supply exactly one endpoint.',
    ),
    blockedProjectId: ProjectId.optional().describe(
      'A Project the path Project blocks. Supply exactly one endpoint.',
    ),
  })
  .refine(
    (value) => (value.blockingProjectId === undefined) !== (value.blockedProjectId === undefined),
    { message: 'Supply exactly one dependency endpoint.' },
  )
  .meta({ id: 'ProjectDependencyCreate', description: 'Create a directed Project dependency.' });
/** Validated Project dependency-create body. */
export type ProjectDependencyCreate = z.infer<typeof ProjectDependencyCreate>;

/** A Project's outgoing and incoming dependency edges. */
export const ProjectDependencyOut = z
  .object({
    blocking: z.array(ProjectRef).describe('Projects the path Project blocks.'),
    blockedBy: z.array(ProjectRef).describe('Projects that block the path Project.'),
  })
  .meta({ id: 'ProjectDependencyOut', description: 'A Project dependency split.' });
/** Project dependency lists value. */
export type ProjectDependencyOut = z.infer<typeof ProjectDependencyOut>;

/** Successful Project dependency create acknowledgement. */
export const ProjectDependencyCreated = z
  .object({
    created: z.literal(true),
    blockingProjectId: ProjectId,
    blockedProjectId: ProjectId,
  })
  .meta({ id: 'ProjectDependencyCreated', description: 'A created Project dependency edge.' });
/** Project dependency create acknowledgement value. */
export type ProjectDependencyCreated = z.infer<typeof ProjectDependencyCreated>;

/** Successful Project dependency removal acknowledgement. */
export const ProjectDependencyRemoved = z
  .object({ removed: z.literal(true) })
  .meta({ id: 'ProjectDependencyRemoved', description: 'A removed Project dependency edge.' });
/** Project dependency removal acknowledgement value. */
export type ProjectDependencyRemoved = z.infer<typeof ProjectDependencyRemoved>;

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
    percent: z
      .number()
      .min(0)
      .max(1)
      .describe(
        'Completion ratio in `[0, 1]` (`completedWeight / totalWeight`). Exactly `0` for an empty project (never NaN). Multiply by 100 for a percentage.',
      ),
    completedWeight: z
      .number()
      .min(0)
      .describe(
        'Summed weight of completed tasks — the estimate sum of completed tasks in estimate mode, or the completed task count in count mode.',
      ),
    totalWeight: z
      .number()
      .min(0)
      .describe(
        'Summed weight of all tasks — the estimate sum in estimate mode (used when any task carries a positive estimate), or the total task count in count-fallback mode.',
      ),
    taskCount: z
      .number()
      .int()
      .min(0)
      .describe(
        'Raw number of tasks in the project (always the row count, regardless of weighting mode).',
      ),
    completedCount: z
      .number()
      .int()
      .min(0)
      .describe(
        'Raw number of completed tasks (those with a `completedAt`), regardless of weighting mode.',
      ),
  })
  .meta({ id: 'ProjectProgress', description: 'Weighted completion roll-up for a project.' });
/** Weighted project-progress value. */
export type ProjectProgress = z.infer<typeof ProjectProgress>;

/**
 * The project-detail extras the project-detail screen can't read cheaply from the org-level
 * lists, served in one round-trip.
 *
 * @remarks
 * The detail screen joins each of the project's tasks to its milestone, resolves the Initiatives
 * the project supports, and shows recent agent activity on its tasks' sessions. Done client-side
 * those become an N+1 (a `tasks/:id` read per task, for the `milestoneId` that only `TaskDetail`
 * carries), an M+1 (an `initiatives/:id/timeline` read per initiative), and a per-session
 * `sessions/:id` fan-out for the activity feed. This roll-up answers all three directly — the
 * `task.milestone_id` column, the `initiative_project` join, and one ordered `session_activity`
 * read across the project's sessions — so the screen makes one bounded read instead of `1 + N + M`.
 */
export const ProjectRollupOut = z
  .object({
    taskMilestones: z
      .array(
        z.object({
          taskId: TaskId.describe('A task belonging to the project.'),
          milestoneId: MilestoneId.nullable().describe(
            'The milestone the task sits under, or `null` when the task is ungrouped.',
          ),
        }),
      )
      .describe(
        'Each of the project’s tasks paired with its milestone — the `milestone_id` that otherwise only `TaskDetail` carries, collapsing an N+1 of per-task reads.',
      ),
    initiativeIds: z
      .array(InitiativeId)
      .describe(
        'All Initiatives this project supports, resolved from the `initiative_project` join in deterministic identifier order.',
      ),
    labels: z.array(LabelOut).describe('Organization-global Labels attached to the Project.'),
    recentActivity: z
      .array(
        SessionActivityOut.extend({
          agentId: AgentId.describe(
            'The agent whose session produced this activity (annotated so the client resolves the actor without a per-session read).',
          ),
        }),
      )
      .describe(
        'Recent activity across the project’s tasks’ agent sessions, newest-first (capped at 8). Each entry is a session-activity row extended with its session’s `agentId`.',
      ),
  })
  .meta({
    id: 'ProjectRollupOut',
    description: "A project's task-to-milestone map, Initiative links, and recent activity.",
  });
/** Project detail roll-up value. */
export type ProjectRollupOut = z.infer<typeof ProjectRollupOut>;
