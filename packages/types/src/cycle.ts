/**
 * `@docket/types` — Cycle slice DTOs.
 */
import { z } from 'zod';

import { CycleId, OrganizationId, ProgramId, ProjectId, TaskId, TeamId } from './primitives';
import { TaskOut } from './task';

/** Cycle (team cadence) status. */
export const CycleStatus = z
  .enum(['upcoming', 'active', 'completed'])
  .describe(
    'Cycle iteration status. `upcoming` = not yet started; `active` = currently running; `completed` = closed/past. For auto-rolled cycles this is seeded from the slot’s position relative to today; the date-derived `isCurrent` flag is the source of truth for "which cycle is now".',
  );
/** Cycle status value. */
export type CycleStatus = z.infer<typeof CycleStatus>;

/** Body for creating a Cycle (organizationId comes from the path, never the body). */
export const CycleCreate = z
  .object({
    teamId: TeamId.describe(
      'The team this cycle belongs to (required). Cycles are team-scoped; re-validated to live in the caller’s org (404 otherwise). Fixed at creation.',
    ),
    number: z
      .number()
      .int()
      .describe(
        'The team-local sequence number. Unique per team (`(teamId, number)` is unique), so reusing a number an existing/auto-rolled cycle holds collides at the database.',
      ),
    name: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Optional display name (e.g. "Sprint 12"). Cycles may be unnamed and identified by number/dates.',
      ),
    startsAt: z.iso.date().describe('Window start (ISO-8601 date/datetime). Required.'),
    endsAt: z.iso.date().describe('Window end (ISO-8601 date/datetime). Required.'),
    status: CycleStatus.optional().describe('Initial status. Defaults to `upcoming` when omitted.'),
  })
  .meta({ id: 'CycleCreate', description: 'Create a cycle within an organization.' });
/** Validated cycle-create body. */
export type CycleCreate = z.infer<typeof CycleCreate>;

/** Body for updating a Cycle (all fields optional; the team is fixed at creation). */
export const CycleUpdate = z
  .object({
    number: z
      .number()
      .int()
      .optional()
      .describe('New team-local sequence number. Omit to leave unchanged (still unique per team).'),
    name: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe('New display name. Omit to leave unchanged; `null` clears it (back to unnamed).'),
    startsAt: z.iso
      .date()
      .optional()
      .describe(
        'New window start (ISO-8601). Omit to leave unchanged. Shifting it changes all date-derived quantities (`isCurrent`, `scopeChange`, burnup day range).',
      ),
    endsAt: z.iso.date().optional().describe('New window end (ISO-8601). Omit to leave unchanged.'),
    status: CycleStatus.optional().describe(
      'New status. Omit to leave unchanged. To end a cycle with carryover review, prefer `POST /:id/close` over setting `completed` here.',
    ),
  })
  .meta({ id: 'CycleUpdate', description: 'Update a cycle.' });
/** Validated cycle-update body. */
export type CycleUpdate = z.infer<typeof CycleUpdate>;

/** Full cycle representation returned by reads. */
export const CycleOut = z
  .object({
    id: CycleId.describe('Stable unique identifier of the cycle.'),
    organizationId: OrganizationId.describe('The owning organization (tenant).'),
    teamId: TeamId.describe('The team this cycle belongs to. Immutable after creation.'),
    number: z.number().int().describe('Team-local sequence number (unique per team).'),
    name: z
      .string()
      .nullable()
      .optional()
      .describe('Display name, or `null`/absent when the cycle is unnamed.'),
    startsAt: z.string().describe('Window start (ISO-8601 timestamp).'),
    endsAt: z.string().describe('Window end (ISO-8601 timestamp).'),
    status: CycleStatus.describe('Current status (`upcoming`/`active`/`completed`).'),
    /**
     * Whether today falls within this cycle's `[startsAt, endsAt]` window.
     *
     * @remarks
     * Date-derived "current" cycle (DECISION: cycles auto-roll on a configurable cadence,
     * so the current cycle is whichever window contains today, not a manually-set status).
     * The Logic phase computes and populates this; reads that don't resolve a window may
     * omit it.
     */
    isCurrent: z
      .boolean()
      .optional()
      .describe(
        'Whether today falls within this cycle’s `[startsAt, endsAt]` window — the date-derived "current cycle" signal (cycles auto-roll on a cadence, so "current" is derived from dates, not the stored `status`). Populated by reads that resolve a window (detail, list, current-window); omitted otherwise.',
      ),
    createdAt: z.string().describe('When the cycle row was created (ISO-8601 timestamp).'),
  })
  .meta({ id: 'CycleOut', description: 'A cycle.' });
/** Cycle representation value. */
export type CycleOut = z.infer<typeof CycleOut>;

/**
 * Rolled-up stats for a cycle, shown in its detail screen's collapsible banner.
 *
 * @remarks
 * Per product §8.5 / data-model §4.4, a cycle screen answers "are we on pace?":
 * - `committed` — count of tasks currently assigned to the cycle.
 * - `completed` — count of those whose workflow state is terminal-completed
 *   (`completed_at` is set).
 * - `capacity` — the sum of the committed tasks' `estimate` points (unestimated
 *   tasks contribute 0), i.e. the planned effort.
 * - `completedCapacity` — the estimate sum of the completed subset (burndown's
 *   "done" weight).
 * - `scopeChange` — count of tasks added to the cycle after `starts_at` (scope
 *   that crept in mid-cycle), inferred from `task.created_at > cycle.starts_at`.
 * - `carryover` — count of still-incomplete committed tasks (what would roll over
 *   if the cycle closed now).
 */
export const CycleStats = z
  .object({
    committed: z.number().int().describe('Count of active tasks currently committed to the cycle.'),
    completed: z
      .number()
      .int()
      .describe(
        'Count of committed tasks whose workflow state is terminal-completed (`completed_at` is set).',
      ),
    capacity: z
      .number()
      .int()
      .describe(
        'Planned effort: the sum of the committed tasks’ `estimate` points (unestimated tasks contribute 0).',
      ),
    completedCapacity: z
      .number()
      .int()
      .describe('The estimate sum of the completed subset — the burndown’s "done" weight.'),
    scopeChange: z
      .number()
      .int()
      .describe(
        'Count of tasks added to the cycle after `starts_at` (mid-cycle scope creep), inferred from `task.created_at > cycle.starts_at`.',
      ),
    carryover: z
      .number()
      .int()
      .describe(
        'Count of still-incomplete committed tasks — what would roll over if the cycle closed now.',
      ),
  })
  .meta({ id: 'CycleStats', description: "A cycle's rolled-up pace stats." });
/** Cycle stats value. */
export type CycleStats = z.infer<typeof CycleStats>;

/** The richer single-cycle read: the cycle plus its rolled-up stats banner. */
export const CycleDetail = CycleOut.extend({
  stats: CycleStats.describe('The cycle’s rolled-up pace stats (the "are we on pace?" banner).'),
}).meta({ id: 'CycleDetail', description: 'A cycle with its rolled-up stats.' });
/** Detailed cycle representation value. */
export type CycleDetail = z.infer<typeof CycleDetail>;

/** Query for the rolling-window / current-cycle read (which team's window to resolve). */
export const CycleWindowQuery = z
  .object({
    teamId: TeamId.describe(
      'The team whose rolling cycle window to resolve (required). Must belong to the caller’s org (404 otherwise).',
    ),
  })
  .meta({ id: 'CycleWindowQuery', description: "Which team's cycle window to resolve." });
/** Validated cycle-window query value. */
export type CycleWindowQuery = z.infer<typeof CycleWindowQuery>;

/**
 * The auto-rolled cycle window for a team: the rolling set of cycles around today
 * plus the date-derived current cycle.
 *
 * @remarks
 * DECISION: cycles auto-roll on a configurable cadence (`team.cycle_cadence_weeks`,
 * default 1 = weekly), so the user never creates cycles by hand. This read lazily
 * ensures a rolling window of cycles exists (a few past + the current + a few
 * upcoming, anchored to a week-aligned start stepping by the team's cadence), then
 * returns them with the `current` cycle broken out. `current` is whichever window
 * contains today (`startsAt <= now <= endsAt`); each cycle in `cycles` carries an
 * `isCurrent` flag for the same derivation. `cadenceWeeks` echoes the team's setting.
 */
export const CycleWindow = z
  .object({
    teamId: TeamId.describe('The team whose window this is.'),
    cadenceWeeks: z
      .number()
      .int()
      .describe(
        'The team’s cycle cadence in weeks (`team.cycle_cadence_weeks`, default 1 = weekly) — echoed here.',
      ),
    current: CycleOut.nullable().describe(
      'The cycle whose window contains today (`startsAt <= now <= endsAt`), or `null` when none does. On a tie the earliest-starting wins.',
    ),
    cycles: z
      .array(CycleOut)
      .describe(
        'The full rolling window — a few past + the current + a few upcoming cycles, ordered by number; each carries its own `isCurrent`.',
      ),
  })
  .meta({
    id: 'CycleWindow',
    description: "A team's rolling cycle window with its current cycle.",
  });
/** Cycle window value. */
export type CycleWindow = z.infer<typeof CycleWindow>;

/** How a cycle's committed tasks are grouped on the detail screen. */
export const CycleTaskGroupBy = z
  .enum(['project', 'program'])
  .describe(
    'The containment axis to group a cycle’s tasks by. `project` buckets by `project_id`; `program` buckets by `program_id`. Either way a `null` bucket holds tasks not filed under that axis.',
  );
/** Cycle task group-by value. */
export type CycleTaskGroupBy = z.infer<typeof CycleTaskGroupBy>;

/** Query for the grouped committed-tasks read. */
export const CycleTasksQuery = z
  .object({
    groupBy: CycleTaskGroupBy.optional().describe(
      'Grouping axis (`project` or `program`). Defaults to `project` when omitted.',
    ),
  })
  .meta({ id: 'CycleTasksQuery', description: "How to group a cycle's tasks." });
/** Validated cycle-tasks query value. */
export type CycleTasksQuery = z.infer<typeof CycleTasksQuery>;

/**
 * One group of committed tasks on the cycle detail screen.
 *
 * @remarks
 * The group key is the grouping entity's id — a `projectId` (when grouped by
 * project) or a `programId` (when grouped by program) — and is `null` for the
 * "no project"/"no program" bucket. Exactly one of the two id fields is populated
 * per response, matching the request's `groupBy`.
 */
export const CycleTaskGroup = z
  .object({
    projectId: ProjectId.nullable()
      .optional()
      .describe(
        'The grouping Project id when `groupBy=project` (the request axis), or `null` for the "no project" bucket. Present only on project-grouped responses.',
      ),
    programId: ProgramId.nullable()
      .optional()
      .describe(
        'The grouping Program id when `groupBy=program`, or `null` for the "no program" bucket. Present only on program-grouped responses. Exactly one of `projectId`/`programId` is populated per response, matching the request.',
      ),
    tasks: z.array(TaskOut).describe('The committed tasks in this group.'),
  })
  .meta({ id: 'CycleTaskGroup', description: 'A group of a cycle’s committed tasks.' });
/** Cycle task group value. */
export type CycleTaskGroup = z.infer<typeof CycleTaskGroup>;

/** The grouped committed-tasks read for a cycle's detail list. */
export const CycleTasksOut = z
  .object({
    groupBy: CycleTaskGroupBy.describe('The axis the tasks were grouped by (echoes the request).'),
    groups: z
      .array(CycleTaskGroup)
      .describe('The task groups, one per distinct grouping entity (plus a `null` bucket).'),
  })
  .meta({ id: 'CycleTasksOut', description: "A cycle's committed tasks, grouped." });
/** Cycle grouped-tasks value. */
export type CycleTasksOut = z.infer<typeof CycleTasksOut>;

/** One day's point on the burn-up line. */
export const CycleBurnupPoint = z
  .object({
    date: z.string().describe('The calendar day (`YYYY-MM-DD`, UTC) this point covers.'),
    planned: z
      .number()
      .int()
      .describe(
        'Cumulative planned effort (capacity) known as of this day — rises as scope is added mid-cycle.',
      ),
    completed: z
      .number()
      .int()
      .describe(
        'Cumulative completed effort whose `completed_at` falls on or before the end of this day.',
      ),
    remaining: z
      .number()
      .int()
      .describe('`planned - completed` as of this day — the open distance to the plan line.'),
  })
  .meta({ id: 'CycleBurnupPoint', description: 'One day on a cycle burn-up line.' });
/** Burn-up point value. */
export type CycleBurnupPoint = z.infer<typeof CycleBurnupPoint>;

/** One scope-change event: a task added to the cycle after it started. */
export const CycleScopeChange = z
  .object({
    taskId: TaskId.describe('The task that was added to the cycle after it started.'),
    addedAt: z
      .string()
      .describe('When it joined the cycle — its `created_at` (ISO-8601 timestamp).'),
    estimate: z
      .number()
      .int()
      .describe('The effort it added to the plan — its estimate, or 0 if unestimated.'),
  })
  .meta({ id: 'CycleScopeChange', description: 'A mid-cycle scope addition.' });
/** Scope-change value. */
export type CycleScopeChange = z.infer<typeof CycleScopeChange>;

/**
 * The cycle burn-up report: a daily planned-vs-done series plus capacity and
 * scope/carryover stats (product §8.5: "are we on pace?").
 *
 * @remarks
 * `series` spans each calendar day of the cycle window (`starts_at`..`ends_at`,
 * inclusive). `planned` is the cumulative committed capacity known by that day
 * (rises as scope is added); `completed` is cumulative effort whose `completed_at`
 * falls on or before that day; `remaining = planned - completed`. `scopeChanges`
 * itemizes every task added after `starts_at`. The flat `stats` mirror
 * {@link CycleStats}.
 */
export const CycleBurnupOut = z
  .object({
    cycleId: CycleId.describe('The cycle this report covers.'),
    startsAt: z.string().describe('The cycle window start (ISO-8601 timestamp).'),
    endsAt: z.string().describe('The cycle window end (ISO-8601 timestamp).'),
    capacity: z
      .number()
      .int()
      .describe(
        'Total planned capacity (estimate sum of committed tasks); mirrors `stats.capacity`.',
      ),
    series: z
      .array(CycleBurnupPoint)
      .describe(
        'One point per calendar day of `[startsAt, endsAt]` inclusive — the daily planned-vs-completed-vs-remaining line.',
      ),
    scopeChanges: z
      .array(CycleScopeChange)
      .describe(
        'Every task added after `starts_at`, sorted by when it joined — the itemized scope creep.',
      ),
    stats: CycleStats.describe('The flat pace stats, mirroring {@link CycleStats}.'),
  })
  .meta({ id: 'CycleBurnupOut', description: "A cycle's burn-up + capacity + scope report." });
/** Burn-up report value. */
export type CycleBurnupOut = z.infer<typeof CycleBurnupOut>;

/** What to do with one incomplete task when the cycle closes. */
export const CycleCarryoverAction = z
  .enum(['keep', 'move', 'triage'])
  .describe(
    'Disposition for an incomplete task at cycle close. `keep` = leave it on the now-closed cycle (no write); `move` = reassign it to `targetCycleId` (required); `triage` = detach it from any cycle, returning it to the team’s triage queue.',
  );
/** Carryover action value. */
export type CycleCarryoverAction = z.infer<typeof CycleCarryoverAction>;

/**
 * One carryover decision for an incomplete task at cycle close.
 *
 * @remarks
 * Per product §8.5, carryover is reviewed before it rolls — nothing moves by
 * accident. `keep` leaves the task on the (now-closed) cycle; `move` reassigns it
 * to `targetCycleId` (required); `triage` detaches it from any cycle, returning it
 * to the team's triage queue.
 */
export const CycleCarryoverDecision = z
  .object({
    taskId: TaskId.describe(
      'The incomplete committed task this decision applies to. Must be an incomplete task currently on the cycle being closed (a completed/unrelated/cross-tenant id is rejected with 422).',
    ),
    action: CycleCarryoverAction.describe('What to do with the task (`keep`/`move`/`triage`).'),
    targetCycleId: CycleId.optional().describe(
      'Required when `action` is `move`: the destination cycle. Must be a DIFFERENT cycle on the SAME team within the org (never the cycle being closed, never cross-team). Ignored for `keep`/`triage`.',
    ),
  })
  .refine((d) => d.action !== 'move' || d.targetCycleId !== undefined, {
    message: 'targetCycleId is required when action is "move"',
    path: ['targetCycleId'],
  })
  .meta({ id: 'CycleCarryoverDecision', description: 'A per-task carryover decision.' });
/** Carryover decision value. */
export type CycleCarryoverDecision = z.infer<typeof CycleCarryoverDecision>;

/**
 * Body for closing a cycle: a per-task carryover decision list for the incomplete
 * tasks, then the cycle is marked `completed` (product §8.5).
 */
export const CycleCloseBody = z
  .object({
    carryover: z
      .array(CycleCarryoverDecision)
      .default([])
      .describe(
        'Per-task disposition for the cycle’s incomplete committed tasks. Defaults to `[]` (close with no explicit carryover — incomplete tasks simply remain on the closed cycle). Only incomplete committed tasks may appear here; completed tasks need no decision. All decisions plus the close apply in one transaction.',
      ),
  })
  .meta({ id: 'CycleCloseBody', description: 'Close a cycle with carryover decisions.' });
/** Validated cycle-close body. */
export type CycleCloseBody = z.infer<typeof CycleCloseBody>;

/** Acknowledgement returned when a cycle is closed. */
export const CycleClosed = z
  .object({
    closed: z.literal(true).describe('Always `true`; the cycle is now `completed`.'),
    keptCount: z
      .number()
      .int()
      .describe('How many incomplete tasks were kept on the closed cycle (`keep`).'),
    movedCount: z
      .number()
      .int()
      .describe('How many incomplete tasks were moved to another cycle (`move`).'),
    triagedCount: z
      .number()
      .int()
      .describe('How many incomplete tasks were detached back to triage (`triage`).'),
  })
  .meta({ id: 'CycleClosed', description: 'A closed-cycle acknowledgement.' });
/** Closed-cycle acknowledgement value. */
export type CycleClosed = z.infer<typeof CycleClosed>;
