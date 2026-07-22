import { cycle, db, integration, task, team } from '@docket/db';
import type { CycleOut } from '@docket/types';
import { type CycleStats, type TaskOut } from '@docket/types';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError } from '../error';
import {
  type CycleWindowSlot,
  isWithinWindow,
  normalizeCadenceWeeks,
  rollingWindow,
} from '../lib/cycle-window';

/** CycleRow is the selected database row shape consumed by these API route serializers. */
export type CycleRow = typeof cycle.$inferSelect;
/** TaskRow is the selected database row shape consumed by these API route serializers. */
export type TaskRow = typeof task.$inferSelect;
/** TeamRow is the selected database row shape consumed by these API route serializers. */
export type TeamRow = typeof team.$inferSelect;

/**
 * Project a cycle row into the {@link CycleOut} wire shape.
 *
 * @param cy - The cycle row.
 * @param now - When provided, populates the date-derived `isCurrent` flag; omitted leaves it undefined.
 */
export function toOut(cy: CycleRow, now?: Date): z.input<typeof CycleOut> {
  return {
    id: cy.id,
    organizationId: cy.organizationId,
    teamId: cy.teamId,
    number: cy.number,
    name: cy.name,
    startsAt: cy.startsAt.toISOString(),
    endsAt: cy.endsAt.toISOString(),
    status: cy.status,
    ...(now ? { isCurrent: isWithinWindow(now, cy.startsAt, cy.endsAt) } : {}),
    createdAt: cy.createdAt.toISOString(),
  };
}

/** Project an active task row into the {@link TaskOut} wire shape. */
export function taskToOut(t: TaskRow): z.input<typeof TaskOut> {
  return {
    id: t.id,
    organizationId: t.organizationId,
    title: t.title,
    summary: t.summary,
    description: t.description,
    teamId: t.teamId,
    state: t.state,
    priority: t.priority,
    assigneeId: t.assigneeId,
    delegateId: t.delegateId,
    projectId: t.projectId,
    programId: t.programId,
    dueDate: t.dueDate?.toISOString() ?? null,
    provenance: {
      source: t.source,
      sourceIntegrationId: t.sourceIntegrationId,
      externalId: t.externalId,
      externalUrl: t.externalUrl,
      syncMode: t.sourceSyncMode,
    },
    createdAt: t.createdAt.toISOString(),
  };
}

/** idParam is the reusable OpenAPI parameter schema for this API route route. */
export const idParam = z.object({ id: z.string() });

/** Load a single cycle scoped to the org, or throw {@link NotFoundError}. */
export async function loadCycle(orgId: string, id: string): Promise<CycleRow> {
  const rows = await db
    .select()
    .from(cycle)
    .where(and(eq(cycle.id, id), eq(cycle.organizationId, orgId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Cycle not found');
  return row;
}

/** Load a team scoped to the org, or throw {@link NotFoundError}. */
export async function loadTeam(orgId: string, teamId: string): Promise<TeamRow> {
  const rows = await db
    .select()
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, orgId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Team not found');
  return row;
}

/** Seed status for an auto-rolled slot from its position relative to `now`. */
export function deriveStatus(slot: CycleWindowSlot, now: Date): CycleRow['status'] {
  if (now.getTime() > slot.endsAt.getTime()) return 'completed';
  if (now.getTime() < slot.startsAt.getTime()) return 'upcoming';
  return 'active';
}

/**
 * Whether a team currently has any provider-mirrored cycle from an ACTIVE integration.
 *
 * @remarks
 * "Active" means `connected` or `error` (a broken-but-still-owned connection) — deliberately
 * NOT `disconnected`: once an integration is severed the team is no longer provider-owned and
 * should revert to native auto-roll rather than staying frozen forever. Used by
 * {@link ensureCycleWindow} to defer cadence entirely to the provider for a mirrored team: a
 * native insert would otherwise collide with (or interleave nonsensically among) the
 * `(teamId, number)` sequence Linear's own cycle numbers already occupy.
 */
async function hasActiveLinkedCycle(orgId: string, teamId: string): Promise<boolean> {
  const rows = await db
    .select({ id: cycle.id })
    .from(cycle)
    .innerJoin(integration, eq(cycle.sourceIntegrationId, integration.id))
    .where(
      and(
        eq(cycle.organizationId, orgId),
        eq(cycle.teamId, teamId),
        eq(cycle.source, 'linked'),
        inArray(integration.status, ['connected', 'error']),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Lazily ensure the rolling window of auto-rolled cycles exists for a team, then return
 * the team's cycles ordered by `number`.
 *
 * @remarks
 * Idempotent: keyed on the stable epoch-anchored cycle `number`; `onConflictDoNothing`
 * tolerates concurrent writers. Manual cycles outside the computed window are untouched.
 * GUARD: a team with any linked cycle from an ACTIVE integration (see
 * {@link hasActiveLinkedCycle}) defers cadence entirely to the provider — no native slots are
 * generated for it, and the team's existing (mirrored + any manual) cycles are simply returned
 * as-is. This prevents native auto-roll from colliding with the provider's own cycle numbering.
 *
 * @param orgId - The tenant.
 * @param teamId - The team whose window to ensure.
 * @param cadenceWeeks - Normalized cadence in weeks (>= 1).
 * @param actorId - Creator stamped on auto-generated cycles.
 * @param now - Reference instant ("today").
 */
export async function ensureCycleWindow(
  orgId: string,
  teamId: string,
  cadenceWeeks: number,
  actorId: string | null,
  now: Date,
): Promise<CycleRow[]> {
  if (!(await hasActiveLinkedCycle(orgId, teamId))) {
    const slots: CycleWindowSlot[] = rollingWindow(now, cadenceWeeks);

    const existing = await db
      .select()
      .from(cycle)
      .where(and(eq(cycle.teamId, teamId), eq(cycle.organizationId, orgId)));
    const existingNumbers = new Set(existing.map((c) => c.number));

    const toInsert = slots
      .filter((s) => !existingNumbers.has(s.number))
      .map((s) => ({
        organizationId: orgId,
        teamId,
        number: s.number,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        status: deriveStatus(s, now),
        createdBy: actorId,
      }));

    if (toInsert.length > 0) {
      await db
        .insert(cycle)
        .values(toInsert)
        .onConflictDoNothing({
          target: [cycle.teamId, cycle.number],
        });
    }
  }

  return db
    .select()
    .from(cycle)
    .where(and(eq(cycle.teamId, teamId), eq(cycle.organizationId, orgId)))
    .orderBy(cycle.number);
}

/**
 * Ensure the rolling cycle window for **every** team in the org (idempotent).
 *
 * @remarks
 * The in-process counterpart to the client formerly calling `GET /cycles/current?teamId=…` once per
 * team before listing: a single batched teams read, then {@link ensureCycleWindow} per team. Run at
 * the top of the cycles list endpoint so the roster auto-rolls server-side — the list is never
 * empty for a real team and callers (browser + SSR) need no per-team ensure fan-out.
 *
 * @param orgId - The tenant.
 * @param actorId - Creator stamped on auto-generated cycles.
 * @param now - Reference instant ("today").
 */
export async function ensureOrgCycleWindows(
  orgId: string,
  actorId: string | null,
  now: Date,
): Promise<void> {
  const teams = await db
    .select({ id: team.id, cadenceWeeks: team.cycleCadenceWeeks })
    .from(team)
    .where(eq(team.organizationId, orgId));
  await Promise.all(
    teams.map((t) =>
      ensureCycleWindow(orgId, t.id, normalizeCadenceWeeks(t.cadenceWeeks), actorId, now),
    ),
  );
}

/**
 * The minimal task shape the pace-stats roll-up reads.
 *
 * @remarks
 * `computeStats`/`effort`/`isCompleted` need only these three columns, so the batched list query
 * ({@link committedTasksForCycles}) can `select` just them instead of whole rows. Full `TaskRow`s
 * (from {@link committedTasks}) satisfy this structurally, so both feed the same helpers.
 */
export type CycleStatTask = Pick<TaskRow, 'estimate' | 'completedAt' | 'createdAt'>;

/** Whether a task counts as completed (its workflow state stamped a `completed_at`). */
export function isCompleted(t: CycleStatTask): boolean {
  return t.completedAt !== null;
}

/** A task's effort weight: its estimate, treating an unestimated task as 0. */
export function effort(t: CycleStatTask): number {
  return t.estimate ?? 0;
}

/** Load every active task currently committed to a cycle (org-scoped). */
export async function committedTasks(orgId: string, cycleId: string): Promise<TaskRow[]> {
  return db
    .select()
    .from(task)
    .where(and(eq(task.cycleId, cycleId), eq(task.organizationId, orgId), isNull(task.archivedAt)));
}

/**
 * Load the active committed tasks for many cycles in **one** query, grouped by cycle id.
 *
 * @remarks
 * The batched counterpart to {@link committedTasks}: the cycles list endpoint rolls up stats for
 * every cycle, so fanning out one query per cycle would be an N+1. This issues a single
 * `inArray` read over the org's cycle ids and groups the result, so the list computes all cycles'
 * stats from one round-trip. An empty id list short-circuits to an empty map (an empty `inArray`
 * is a degenerate query).
 *
 * @param orgId - The active org id (scopes the read).
 * @param cycleIds - The cycle ids to load committed tasks for.
 * @returns A map from cycle id to that cycle's active committed tasks (absent ids → no entry).
 */
export async function committedTasksForCycles(
  orgId: string,
  cycleIds: readonly string[],
): Promise<Map<string, CycleStatTask[]>> {
  const byCycle = new Map<string, CycleStatTask[]>();
  if (cycleIds.length === 0) return byCycle;
  // Select only the columns the stats roll-up reads (+ cycleId to group by) rather than whole
  // rows — the list rolls up every committed task across every cycle, so the row width matters.
  const rows = await db
    .select({
      cycleId: task.cycleId,
      estimate: task.estimate,
      completedAt: task.completedAt,
      createdAt: task.createdAt,
    })
    .from(task)
    .where(
      and(
        inArray(task.cycleId, [...cycleIds]),
        eq(task.organizationId, orgId),
        isNull(task.archivedAt),
      ),
    );
  for (const t of rows) {
    if (!t.cycleId) continue;
    const bucket = byCycle.get(t.cycleId);
    if (bucket) bucket.push(t);
    else byCycle.set(t.cycleId, [t]);
  }
  return byCycle;
}

/** Roll a cycle's committed tasks up into its pace stats. */
export function computeStats(cy: CycleRow, tasks: readonly CycleStatTask[]): CycleStats {
  let completed = 0;
  let capacity = 0;
  let completedCapacity = 0;
  let scopeChange = 0;
  let carryover = 0;
  for (const t of tasks) {
    const e = effort(t);
    capacity += e;
    if (isCompleted(t)) {
      completed += 1;
      completedCapacity += e;
    } else {
      carryover += 1;
    }
    if (t.createdAt.getTime() > cy.startsAt.getTime()) scopeChange += 1;
  }
  return {
    committed: tasks.length,
    completed,
    capacity,
    completedCapacity,
    scopeChange,
    carryover,
  };
}
