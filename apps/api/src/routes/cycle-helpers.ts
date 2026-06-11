import { cycle, db, task, team } from '@docket/db';
import type { CycleOut } from '@docket/types';
import { type CycleStats, type TaskOut } from '@docket/types';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError } from '../error';
import { type CycleWindowSlot, isWithinWindow, rollingWindow } from '../lib/cycle-window';

export type CycleRow = typeof cycle.$inferSelect;
export type TaskRow = typeof task.$inferSelect;
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
 * Lazily ensure the rolling window of auto-rolled cycles exists for a team, then return
 * the team's cycles ordered by `number`.
 *
 * @remarks
 * Idempotent: keyed on the stable epoch-anchored cycle `number`; `onConflictDoNothing`
 * tolerates concurrent writers. Manual cycles outside the computed window are untouched.
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

  return db
    .select()
    .from(cycle)
    .where(and(eq(cycle.teamId, teamId), eq(cycle.organizationId, orgId)))
    .orderBy(cycle.number);
}

/** Whether a task counts as completed (its workflow state stamped a `completed_at`). */
export function isCompleted(t: TaskRow): boolean {
  return t.completedAt !== null;
}

/** A task's effort weight: its estimate, treating an unestimated task as 0. */
export function effort(t: TaskRow): number {
  return t.estimate ?? 0;
}

/** Load every active task currently committed to a cycle (org-scoped). */
export async function committedTasks(orgId: string, cycleId: string): Promise<TaskRow[]> {
  return db
    .select()
    .from(task)
    .where(and(eq(task.cycleId, cycleId), eq(task.organizationId, orgId), isNull(task.archivedAt)));
}

/** Roll a cycle's committed tasks up into its pace stats. */
export function computeStats(cy: CycleRow, tasks: TaskRow[]): CycleStats {
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
