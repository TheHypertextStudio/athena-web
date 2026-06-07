/**
 * `@docket/types` — Cycle slice DTOs.
 */
import { z } from 'zod';

import { CycleId, OrganizationId, ProgramId, ProjectId, TaskId, TeamId } from './primitives';
import { TaskOut } from './task';

/** Cycle (team cadence) status. */
export const CycleStatus = z.enum(['upcoming', 'active', 'completed']);
/** Cycle status value. */
export type CycleStatus = z.infer<typeof CycleStatus>;

/** Body for creating a Cycle (organizationId comes from the path, never the body). */
export const CycleCreate = z
  .object({
    teamId: TeamId,
    number: z.number().int(),
    name: z.string().min(1).optional(),
    startsAt: z.iso.date(),
    endsAt: z.iso.date(),
    status: CycleStatus.optional(),
  })
  .meta({ id: 'CycleCreate', description: 'Create a cycle within an organization.' });
/** Validated cycle-create body. */
export type CycleCreate = z.infer<typeof CycleCreate>;

/** Body for updating a Cycle (all fields optional; the team is fixed at creation). */
export const CycleUpdate = z
  .object({
    number: z.number().int().optional(),
    name: z.string().min(1).nullable().optional(),
    startsAt: z.iso.date().optional(),
    endsAt: z.iso.date().optional(),
    status: CycleStatus.optional(),
  })
  .meta({ id: 'CycleUpdate', description: 'Update a cycle.' });
/** Validated cycle-update body. */
export type CycleUpdate = z.infer<typeof CycleUpdate>;

/** Full cycle representation returned by reads. */
export const CycleOut = z
  .object({
    id: CycleId,
    organizationId: OrganizationId,
    teamId: TeamId,
    number: z.number().int(),
    name: z.string().nullable().optional(),
    startsAt: z.string(),
    endsAt: z.string(),
    status: CycleStatus,
    createdAt: z.string(),
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
    committed: z.number().int(),
    completed: z.number().int(),
    capacity: z.number().int(),
    completedCapacity: z.number().int(),
    scopeChange: z.number().int(),
    carryover: z.number().int(),
  })
  .meta({ id: 'CycleStats', description: "A cycle's rolled-up pace stats." });
/** Cycle stats value. */
export type CycleStats = z.infer<typeof CycleStats>;

/** The richer single-cycle read: the cycle plus its rolled-up stats banner. */
export const CycleDetail = CycleOut.extend({
  stats: CycleStats,
}).meta({ id: 'CycleDetail', description: 'A cycle with its rolled-up stats.' });
/** Detailed cycle representation value. */
export type CycleDetail = z.infer<typeof CycleDetail>;

/** How a cycle's committed tasks are grouped on the detail screen. */
export const CycleTaskGroupBy = z.enum(['project', 'program']);
/** Cycle task group-by value. */
export type CycleTaskGroupBy = z.infer<typeof CycleTaskGroupBy>;

/** Query for the grouped committed-tasks read. */
export const CycleTasksQuery = z
  .object({
    groupBy: CycleTaskGroupBy.optional(),
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
    projectId: ProjectId.nullable().optional(),
    programId: ProgramId.nullable().optional(),
    tasks: z.array(TaskOut),
  })
  .meta({ id: 'CycleTaskGroup', description: 'A group of a cycle’s committed tasks.' });
/** Cycle task group value. */
export type CycleTaskGroup = z.infer<typeof CycleTaskGroup>;

/** The grouped committed-tasks read for a cycle's detail list. */
export const CycleTasksOut = z
  .object({
    groupBy: CycleTaskGroupBy,
    groups: z.array(CycleTaskGroup),
  })
  .meta({ id: 'CycleTasksOut', description: "A cycle's committed tasks, grouped." });
/** Cycle grouped-tasks value. */
export type CycleTasksOut = z.infer<typeof CycleTasksOut>;

/** One day's point on the burn-up line. */
export const CycleBurnupPoint = z
  .object({
    /** The calendar day (`YYYY-MM-DD`) this point covers. */
    date: z.string(),
    /** Cumulative planned effort (capacity) committed as of this day. */
    planned: z.number().int(),
    /** Cumulative completed effort as of end of this day. */
    completed: z.number().int(),
    /** Remaining effort (`planned - completed`) as of this day. */
    remaining: z.number().int(),
  })
  .meta({ id: 'CycleBurnupPoint', description: 'One day on a cycle burn-up line.' });
/** Burn-up point value. */
export type CycleBurnupPoint = z.infer<typeof CycleBurnupPoint>;

/** One scope-change event: a task added to the cycle after it started. */
export const CycleScopeChange = z
  .object({
    /** The task that was added mid-cycle. */
    taskId: TaskId,
    /** When it joined the cycle (its `created_at`). */
    addedAt: z.string(),
    /** Its estimate (effort) added to the plan, or 0 if unestimated. */
    estimate: z.number().int(),
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
    cycleId: CycleId,
    startsAt: z.string(),
    endsAt: z.string(),
    capacity: z.number().int(),
    series: z.array(CycleBurnupPoint),
    scopeChanges: z.array(CycleScopeChange),
    stats: CycleStats,
  })
  .meta({ id: 'CycleBurnupOut', description: "A cycle's burn-up + capacity + scope report." });
/** Burn-up report value. */
export type CycleBurnupOut = z.infer<typeof CycleBurnupOut>;

/** What to do with one incomplete task when the cycle closes. */
export const CycleCarryoverAction = z.enum(['keep', 'move', 'triage']);
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
    taskId: TaskId,
    action: CycleCarryoverAction,
    targetCycleId: CycleId.optional(),
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
    carryover: z.array(CycleCarryoverDecision).default([]),
  })
  .meta({ id: 'CycleCloseBody', description: 'Close a cycle with carryover decisions.' });
/** Validated cycle-close body. */
export type CycleCloseBody = z.infer<typeof CycleCloseBody>;

/** Acknowledgement returned when a cycle is closed. */
export const CycleClosed = z
  .object({
    closed: z.literal(true),
    keptCount: z.number().int(),
    movedCount: z.number().int(),
    triagedCount: z.number().int(),
  })
  .meta({ id: 'CycleClosed', description: 'A closed-cycle acknowledgement.' });
/** Closed-cycle acknowledgement value. */
export type CycleClosed = z.infer<typeof CycleClosed>;
