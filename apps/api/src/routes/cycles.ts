/**
 * `@docket/api` — cycles router (mounted at `/v1/orgs/:orgId/cycles`).
 *
 * @remarks
 * Team-scoped time windows: list/create plus single-cycle detail (with rolled-up
 * stats), update, the grouped committed-task list, the burn-up report (planned vs
 * done over the window + capacity + scope/carryover), and close (carryover review
 * before roll, then mark `completed`). Every query is scoped by `actorCtx.orgId`.
 */
import { cycle, db, task, team } from '@docket/db';
import {
  CycleBurnupOut,
  CycleClosed,
  CycleCloseBody,
  CycleCreate,
  CycleDetail,
  CycleOut,
  type CycleStats,
  CycleTasksOut,
  CycleTasksQuery,
  CycleUpdate,
  CycleWindow,
  CycleWindowQuery,
  pageOf,
  type TaskOut,
} from '@docket/types';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError, ValidationError } from '../error';
import {
  type CycleWindowSlot,
  isWithinWindow,
  normalizeCadenceWeeks,
  rollingWindow,
} from '../lib/cycle-window';
import { ok } from '../lib/ok';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

type CycleRow = typeof cycle.$inferSelect;
type TaskRow = typeof task.$inferSelect;

/**
 * Project a cycle row into the {@link CycleOut} wire shape.
 *
 * @param cy - The cycle row.
 * @param now - When provided, populates the date-derived `isCurrent` flag (today within
 *   `[startsAt, endsAt]`); omitted leaves `isCurrent` undefined for reads that don't
 *   resolve a "current" cycle.
 */
function toOut(cy: CycleRow, now?: Date): z.input<typeof CycleOut> {
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
function taskToOut(t: TaskRow): z.input<typeof TaskOut> {
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

const idParam = z.object({ id: z.string() });

type TeamRow = typeof team.$inferSelect;

/** Load a single cycle scoped to the org, or throw {@link NotFoundError}. */
async function loadCycle(orgId: string, id: string): Promise<CycleRow> {
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
async function loadTeam(orgId: string, teamId: string): Promise<TeamRow> {
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
function deriveStatus(slot: CycleWindowSlot, now: Date): CycleRow['status'] {
  if (now.getTime() > slot.endsAt.getTime()) return 'completed';
  if (now.getTime() < slot.startsAt.getTime()) return 'upcoming';
  return 'active';
}

/**
 * Lazily ensure the rolling window of auto-rolled cycles exists for a team, then return
 * the team's cycles ordered by `number`.
 *
 * @remarks
 * DECISION: cycles auto-roll on a configurable cadence so the user never creates them by
 * hand. This computes the week-aligned, cadence-stepped window around `now` (a few past +
 * the current + a few upcoming) and inserts only the windows that don't already exist for
 * the team — keyed on the stable, epoch-anchored cycle `number` (which never changes for
 * a given calendar window), so the pass is idempotent and re-running never duplicates or
 * renumbers a cycle. Manual cycles (any `number` outside the computed window) are left
 * untouched and still returned.
 *
 * The insert tolerates a concurrent writer via `onConflictDoNothing` on the
 * `(team_id, number)` uniqueness constraint, then re-reads so the caller always sees the
 * full, consistent set.
 *
 * @param orgId - The tenant.
 * @param teamId - The team whose window to ensure (must belong to `orgId`).
 * @param cadenceWeeks - The team's cadence in weeks (normalized to >= 1).
 * @param actorId - The creator stamped on auto-generated cycles.
 * @param now - The reference instant ("today").
 * @returns Every cycle for the team, ordered ascending by `number`.
 */
async function ensureCycleWindow(
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
      // The real source of truth for "current" is the date window (`isCurrent`), not this
      // column; we still seed a sensible status from the window's position relative to
      // `now` so reads/UI that display it stay coherent (past → completed, the window
      // containing today → active, future → upcoming).
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
function isCompleted(t: TaskRow): boolean {
  return t.completedAt !== null;
}

/** A task's effort weight: its estimate, treating an unestimated task as 0. */
function effort(t: TaskRow): number {
  return t.estimate ?? 0;
}

/** Load every active task currently committed to a cycle (org-scoped). */
async function committedTasks(orgId: string, cycleId: string): Promise<TaskRow[]> {
  return db
    .select()
    .from(task)
    .where(and(eq(task.cycleId, cycleId), eq(task.organizationId, orgId), isNull(task.archivedAt)));
}

/** Roll a cycle's committed tasks up into its pace stats. */
function computeStats(cy: CycleRow, tasks: TaskRow[]): CycleStats {
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
    // Scope that crept in: a task created after the cycle window opened.
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

/** Cycles router: org-scoped CRUD; `contribute` to mutate. */
const cycles = new Hono<AppEnv>()
  .get('/', async (c) => {
    const { orgId } = c.get('actorCtx');
    const now = new Date();
    const rows = await db
      .select()
      .from(cycle)
      .where(eq(cycle.organizationId, orgId))
      .orderBy(desc(cycle.startsAt));
    // Surface the date-derived `isCurrent` on every listed cycle (whichever window
    // contains today), so callers don't have to re-derive it client-side.
    return ok(c, pageOf(CycleOut), { items: rows.map((r) => toOut(r, now)) });
  })
  .get('/current', zQuery(CycleWindowQuery), async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const { teamId } = c.req.valid('query');
    const now = new Date();

    // Auto-roll: lazily ensure the rolling window exists for the team (idempotent), then
    // derive the current cycle by date. The team must belong to the org (404 otherwise).
    const teamRow = await loadTeam(orgId, teamId);
    const cadenceWeeks = normalizeCadenceWeeks(teamRow.cycleCadenceWeeks);
    const rows = await ensureCycleWindow(orgId, teamId, cadenceWeeks, actorId, now);

    // The current cycle is whichever window contains today; on the (impossible for
    // auto-rolled, possible for overlapping manual) tie, the earliest-starting wins.
    const current =
      rows
        .filter((r) => isWithinWindow(now, r.startsAt, r.endsAt))
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0] ?? null;

    const payload: z.input<typeof CycleWindow> = {
      teamId,
      cadenceWeeks,
      current: current ? toOut(current, now) : null,
      cycles: rows.map((r) => toOut(r, now)),
    };
    return ok(c, CycleWindow, payload);
  })
  .post('/', capabilityGuard('contribute'), zJson(CycleCreate), async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const body = c.req.valid('json');

    const teamRows = await db
      .select()
      .from(team)
      .where(and(eq(team.id, body.teamId), eq(team.organizationId, orgId)))
      .limit(1);
    if (!teamRows[0]) throw new NotFoundError('Team not found');

    const inserted = await db
      .insert(cycle)
      .values({
        organizationId: orgId,
        teamId: body.teamId,
        number: body.number,
        name: body.name,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        status: body.status ?? 'upcoming',
        createdBy: actorId,
      })
      .returning();
    const row = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
    if (!row) throw new Error('cycle insert returned no row');
    return ok(c, CycleOut, toOut(row));
  })
  .get('/:id', zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const row = await loadCycle(orgId, id);
    const tasks = await committedTasks(orgId, id);
    const detail: z.input<typeof CycleDetail> = {
      ...toOut(row, new Date()),
      stats: computeStats(row, tasks),
    };
    return ok(c, CycleDetail, detail);
  })
  .patch('/:id', capabilityGuard('contribute'), zParam(idParam), zJson(CycleUpdate), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const updated = await db
      .update(cycle)
      .set({
        ...(body.number !== undefined ? { number: body.number } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.startsAt !== undefined ? { startsAt: new Date(body.startsAt) } : {}),
        ...(body.endsAt !== undefined ? { endsAt: new Date(body.endsAt) } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      })
      .where(and(eq(cycle.id, id), eq(cycle.organizationId, orgId)))
      .returning();
    const row = updated[0];
    if (!row) throw new NotFoundError('Cycle not found');
    return ok(c, CycleOut, toOut(row));
  })
  .delete('/:id', capabilityGuard('contribute'), zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const deleted = await db
      .delete(cycle)
      .where(and(eq(cycle.id, id), eq(cycle.organizationId, orgId)))
      .returning();
    const row = deleted[0];
    if (!row) throw new NotFoundError('Cycle not found');
    return ok(c, CycleOut, toOut(row));
  })
  .get('/:id/tasks', zParam(idParam), zQuery(CycleTasksQuery), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const { groupBy = 'project' } = c.req.valid('query');
    await loadCycle(orgId, id);
    const tasks = await committedTasks(orgId, id);

    // Group committed tasks by the requested containment axis (Project or Program).
    // The bucket key is the entity id, or `null` for the no-project/no-program bucket.
    const buckets = new Map<string | null, TaskRow[]>();
    for (const t of tasks) {
      const key = groupBy === 'project' ? t.projectId : t.programId;
      const list = buckets.get(key);
      if (list) list.push(t);
      else buckets.set(key, [t]);
    }

    const groups: z.input<typeof CycleTasksOut>['groups'] = [...buckets.entries()].map(
      ([key, list]) => ({
        ...(groupBy === 'project' ? { projectId: key } : { programId: key }),
        tasks: list.map(taskToOut),
      }),
    );
    return ok(c, CycleTasksOut, { groupBy, groups });
  })
  .get('/:id/burnup', zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const cy = await loadCycle(orgId, id);
    const tasks = await committedTasks(orgId, id);
    const stats = computeStats(cy, tasks);

    // Itemize scope that crept in after the window opened (sorted by when it joined).
    const scopeChanges = tasks
      .filter((t) => t.createdAt.getTime() > cy.startsAt.getTime())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((t) => ({
        taskId: t.id,
        addedAt: t.createdAt.toISOString(),
        estimate: effort(t),
      }));

    // Walk each calendar day of the window [starts_at, ends_at] inclusive, accruing
    // cumulative planned capacity (rises as scope is added) and cumulative completed
    // effort (a task's weight lands on the day its completed_at falls). `remaining`
    // is the gap between the two — the burn-up's open distance to the plan line.
    const series: z.input<typeof CycleBurnupOut>['series'] = [];
    const dayMs = 86_400_000;
    const start = Date.UTC(
      cy.startsAt.getUTCFullYear(),
      cy.startsAt.getUTCMonth(),
      cy.startsAt.getUTCDate(),
    );
    const end = Date.UTC(
      cy.endsAt.getUTCFullYear(),
      cy.endsAt.getUTCMonth(),
      cy.endsAt.getUTCDate(),
    );
    for (let day = start; day <= end; day += dayMs) {
      const dayEnd = day + dayMs;
      let planned = 0;
      let completed = 0;
      for (const t of tasks) {
        // A task is "planned" from the day it joined the cycle (its created_at), but
        // never before the window opens — pre-window tasks count from day one.
        if (t.createdAt.getTime() < dayEnd) planned += effort(t);
        if (t.completedAt !== null && t.completedAt.getTime() < dayEnd) completed += effort(t);
      }
      series.push({
        date: new Date(day).toISOString().slice(0, 10),
        planned,
        completed,
        remaining: planned - completed,
      });
    }

    const payload: z.input<typeof CycleBurnupOut> = {
      cycleId: cy.id,
      startsAt: cy.startsAt.toISOString(),
      endsAt: cy.endsAt.toISOString(),
      capacity: stats.capacity,
      series,
      scopeChanges,
      stats,
    };
    return ok(c, CycleBurnupOut, payload);
  })
  .post(
    '/:id/close',
    capabilityGuard('contribute'),
    zParam(idParam),
    zJson(CycleCloseBody),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { carryover } = c.req.valid('json');
      const cy = await loadCycle(orgId, id);

      // Carryover is reviewed before it rolls (product §8.5): apply each per-task
      // decision for the cycle's still-incomplete committed tasks, then mark closed.
      const tasks = await committedTasks(orgId, id);
      const incomplete = new Map(tasks.filter((t) => !isCompleted(t)).map((t) => [t.id, t]));

      let keptCount = 0;
      let movedCount = 0;
      let triagedCount = 0;

      await db.transaction(async (tx) => {
        for (const decision of carryover) {
          // Every decision must name an incomplete committed task of THIS cycle —
          // a completed task, an unrelated task, or a cross-tenant id is rejected.
          if (!incomplete.has(decision.taskId)) {
            throw new ValidationError(
              new z.ZodError([
                {
                  code: 'custom',
                  path: ['carryover'],
                  message: `Task '${decision.taskId}' is not an incomplete task on this cycle`,
                  input: decision.taskId,
                },
              ]),
            );
          }

          if (decision.action === 'keep') {
            // Leaves the task on the (now-closed) cycle: no write needed.
            keptCount += 1;
            continue;
          }

          if (decision.action === 'move') {
            /* v8 ignore next -- @preserve defensive: the DTO refine guarantees targetCycleId is set for "move" */
            if (decision.targetCycleId === undefined) {
              throw new ValidationError(
                new z.ZodError([
                  {
                    code: 'custom',
                    path: ['carryover', 'targetCycleId'],
                    message: 'targetCycleId is required when action is "move"',
                    input: decision.targetCycleId,
                  },
                ]),
              );
            }
            // The target must be another cycle on the SAME team (cycles are team-scoped)
            // within this org — never the cycle being closed, never a cross-team cycle.
            const targetRows = await tx
              .select()
              .from(cycle)
              .where(
                and(
                  eq(cycle.id, decision.targetCycleId),
                  eq(cycle.organizationId, orgId),
                  eq(cycle.teamId, cy.teamId),
                ),
              )
              .limit(1);
            if (!targetRows[0] || decision.targetCycleId === id) {
              throw new ValidationError(
                new z.ZodError([
                  {
                    code: 'custom',
                    path: ['carryover', 'targetCycleId'],
                    message: 'targetCycleId must be a different cycle on the same team',
                    input: decision.targetCycleId,
                  },
                ]),
              );
            }
            await tx
              .update(task)
              .set({ cycleId: decision.targetCycleId })
              .where(and(eq(task.id, decision.taskId), eq(task.organizationId, orgId)));
            movedCount += 1;
            continue;
          }

          // 'triage': detach from any cycle, returning the task to the triage queue.
          await tx
            .update(task)
            .set({ cycleId: null })
            .where(and(eq(task.id, decision.taskId), eq(task.organizationId, orgId)));
          triagedCount += 1;
        }

        await tx
          .update(cycle)
          .set({ status: 'completed' })
          .where(and(eq(cycle.id, id), eq(cycle.organizationId, orgId)));
      });

      return ok(c, CycleClosed, { closed: true, keptCount, movedCount, triagedCount });
    },
  );

export default cycles;
