/** `@docket/api` — cycles router (mounted at `/v1/orgs/:orgId/cycles`). */
import { cycle, db, task, team } from '@docket/db';
import {
  CycleBurnupOut,
  CycleClosed,
  CycleCloseBody,
  CycleCreate,
  CycleDetail,
  CycleOut,
  CycleTasksOut,
  CycleTasksQuery,
  CycleUpdate,
  CycleWindow,
  CycleWindowQuery,
  CursorQuery,
  pageOf,
} from '@docket/types';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError, ValidationError } from '../error';
import { isWithinWindow, normalizeCadenceWeeks } from '../lib/cycle-window';
import { ok } from '../lib/ok';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

import { pageResult, seekAfter } from '../lib/list-cursor';
import {
  committedTasks,
  committedTasksForCycles,
  computeStats,
  ensureCycleWindow,
  ensureOrgCycleWindows,
  idParam,
  isCompleted,
  loadCycle,
  loadTeam,
  taskToOut,
  toOut,
} from './cycle-helpers';
import { buildCycleBurnupPayload } from './cycle-burnup';

/**
 * The cycles list query: cursor pagination plus an opt-in `roll` flag. The list surfaces pass
 * `roll=true` to auto-materialize every team's rolling window before listing; other callers omit it
 * and get the raw stored roster with no side effect.
 */
const CycleListQuery = CursorQuery.extend({ roll: z.enum(['true', 'false']).optional() });

/** Cycles router: org-scoped CRUD; `contribute` to mutate. */
const cycles = new Hono<AppEnv>()
  .get('/', zQuery(CycleListQuery), async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const { cursor, limit, roll } = c.req.valid('query');
    const now = new Date();

    // Auto-roll opt-in: the list surfaces want the live rolling window, so `roll=true` materializes
    // every team's window in-process first — one batched ensure instead of a per-team `/current`
    // HTTP fan-out (T self-HTTP round-trips on SSR). Other callers get the raw stored roster.
    if (roll === 'true') await ensureOrgCycleWindows(orgId, actorId, now);

    // Keyset-paginate the roster (newest-first by start, id as tiebreak). `limit` is optional:
    // omitted, the full roster is returned as before; supplied, a bounded page + `nextCursor`.
    const base = db
      .select()
      .from(cycle)
      .where(and(eq(cycle.organizationId, orgId), seekAfter(cycle.startsAt, cycle.id, cursor)))
      .orderBy(desc(cycle.startsAt), desc(cycle.id));
    const rows = await (limit === undefined ? base : base.limit(limit + 1));
    const { items: pageRows, nextCursor } = pageResult(rows, limit, (r) => r.startsAt);

    // Roll up each cycle's pace stats inline so callers render a complete roster without a
    // per-cycle fan-out — the committed tasks for the page's cycles are fetched in a single
    // batched query, then folded through the same pure `computeStats` the detail endpoint uses.
    // Each item also surfaces the date-derived `isCurrent`.
    const tasksByCycle = await committedTasksForCycles(
      orgId,
      pageRows.map((r) => r.id),
    );
    const items: z.input<typeof CycleDetail>[] = pageRows.map((r) => ({
      ...toOut(r, now),
      stats: computeStats(r, tasksByCycle.get(r.id) ?? []),
    }));
    return ok(c, pageOf(CycleDetail), { items, nextCursor });
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
    const buckets = new Map<string | null, (typeof tasks)[number][]>();
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
    return ok(c, CycleBurnupOut, await buildCycleBurnupPayload(orgId, id));
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
