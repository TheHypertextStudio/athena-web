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
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';

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
  .get(
    '/',
    apiDoc({
      tag: 'Cycles',
      summary: 'List cycles',
      response: pageOf(CycleDetail),
      description: `List the organization's cycles — fixed-length team iterations (sprints) on a configurable cadence. Each item is a {@link CycleDetail}: the cycle plus its pace \`stats\` (committed/completed/capacity/scopeChange/carryover) folded in inline, and the date-derived \`isCurrent\` flag, so a roster renders complete without a per-cycle fan-out. The page's committed tasks are fetched in ONE batched query and run through the same pure \`computeStats\` the detail endpoint uses (avoiding an N+1). Keyset-paginated newest-first by \`startsAt\` (\`id\` tiebreak); \`limit\` optional. Opt-in side effect: pass \`roll=true\` to auto-materialize every team's rolling cycle window in-process before listing (one batched ensure instead of a per-team \`/current\` HTTP fan-out on SSR) — so surfaces that need the live rolling roster never see an empty list; other callers omit \`roll\` and get the raw stored roster with NO write. Read-only otherwise; org membership suffices. Returns a page of {@link CycleDetail}.`,
    }),
    zQuery(CycleListQuery),
    async (c) => {
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
    },
  )
  .get(
    '/current',
    apiDoc({
      tag: 'Cycles',
      summary: 'Get current cycle window',
      response: CycleWindow,
      description: `Resolve a team's rolling cycle window plus its current cycle. Cycles auto-roll on a configurable cadence (\`team.cycle_cadence_weeks\`, default 1 = weekly) so users never create cycles by hand. The required \`teamId\` query names the team (which must belong to the caller's org — 404 \`Team not found\` otherwise). Side effect: this lazily and idempotently ENSURES the rolling window exists — a few past cycles + the current + a few upcoming, anchored to a week-aligned start and stepping by the team's cadence — inserting any missing slots (concurrency-safe via \`onConflictDoNothing\` on the stable epoch-anchored cycle \`number\`); existing and manually-created cycles are left untouched. It then returns all the team's cycles with \`current\` broken out — whichever window contains today (\`startsAt <= now <= endsAt\`); on a tie the earliest-starting wins. Each cycle in \`cycles\` carries the same date-derived \`isCurrent\`, and \`cadenceWeeks\` echoes the team's setting. Requires no capability guard, but note it writes (the ensure) — it is a read with an idempotent materialization side effect. Returns {@link CycleWindow}.`,
    }),
    zQuery(CycleWindowQuery),
    async (c) => {
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
    },
  )
  .post(
    '/',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Cycles',
      summary: 'Create a cycle',
      capability: 'contribute',
      response: CycleOut,
      description: `Manually create a cycle for a team. Although cycles normally auto-roll (see \`GET /current\`), this endpoint backs explicit creation. The body's \`teamId\` is required and re-read scoped to the caller's org (404 \`Team not found\`, existence-hiding) — cycles are team-scoped and cannot be created cross-tenant. \`number\` (the team-local sequence number), \`startsAt\`, and \`endsAt\` are required ISO dates/values; \`name\` is optional; \`status\` defaults to \`upcoming\`. Note the \`(teamId, number)\` pair is unique per team, so reusing a number a manual or auto-rolled cycle already holds collides at the database. Requires \`contribute\`. Returns the created {@link CycleOut} (the flat shape, without the \`stats\` roll-up — fetch \`GET /:id\` for those).`,
    }),
    zJson(CycleCreate),
    async (c) => {
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
      await enqueueSearchUpsert(orgId, 'cycle', row.id);
      return ok(c, CycleOut, toOut(row));
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Cycles',
      summary: 'Get cycle detail',
      response: CycleDetail,
      description: `Fetch a single cycle plus its rolled-up pace \`stats\` — the "are we on pace?" banner. The cycle must exist in the caller's org (404 \`Cycle not found\`). \`stats\` is computed from the cycle's active committed tasks: \`committed\` (tasks currently on the cycle), \`completed\` (those with a \`completed_at\`), \`capacity\` (sum of committed estimates, unestimated = 0), \`completedCapacity\` (estimate sum of the completed subset), \`scopeChange\` (tasks added after \`starts_at\`, i.e. mid-cycle scope creep), and \`carryover\` (still-incomplete committed tasks — what would roll if the cycle closed now). The response also carries the date-derived \`isCurrent\`. Read-only; org membership suffices. Returns {@link CycleDetail}. See \`GET /:id/burnup\` for the daily series and \`GET /:id/tasks\` for the grouped task list.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const row = await loadCycle(orgId, id);
      const tasks = await committedTasks(orgId, id);
      const detail: z.input<typeof CycleDetail> = {
        ...toOut(row, new Date()),
        stats: computeStats(row, tasks),
      };
      return ok(c, CycleDetail, detail);
    },
  )
  .patch(
    '/:id',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Cycles',
      summary: 'Update a cycle',
      capability: 'contribute',
      response: CycleOut,
      description: `Partially update a cycle's \`number\`, \`name\`, \`startsAt\`, \`endsAt\`, and/or \`status\`. Each field is optional: an absent key leaves the column untouched (an explicit \`null\` \`name\` clears it). The team is fixed at creation — there is no \`teamId\` in the body, so a cycle cannot be moved between teams. Editing \`startsAt\`/\`endsAt\` shifts the window, which in turn changes every date-derived quantity (\`isCurrent\`, \`scopeChange\`, and the \`burnup\` series day range) the next time they are read. To formally end a cycle with carryover review, prefer \`POST /:id/close\` over manually setting \`status\` to \`completed\` here. 404 (\`Cycle not found\`) when absent or cross-tenant. Requires \`contribute\`. Returns the updated {@link CycleOut}.`,
    }),
    zParam(idParam),
    zJson(CycleUpdate),
    async (c) => {
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
      await enqueueSearchUpsert(orgId, 'cycle', row.id);
      return ok(c, CycleOut, toOut(row));
    },
  )
  .delete(
    '/:id',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Cycles',
      summary: 'Delete a cycle',
      capability: 'contribute',
      response: CycleOut,
      description: `Delete a cycle, scoped to the caller's org (404 \`Cycle not found\` when absent or cross-tenant). Like the other cycle mutations this requires only \`contribute\` (a cycle is a team's cadence container, not an org-structural one). Tasks committed to the deleted cycle have their \`cycle_id\` resolved by the database's foreign-key rules rather than re-implemented here (they are not deleted). Beware: if this cycle is part of an auto-rolled window, a later \`GET /current\` (or a list with \`roll=true\`) will re-materialize the slot for its \`number\`, so deletion is durable only for cycles outside the live rolling window. To wind a cycle down with proper carryover handling use \`POST /:id/close\` instead. Returns the deleted {@link CycleOut} as a tombstone.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const deleted = await db
        .delete(cycle)
        .where(and(eq(cycle.id, id), eq(cycle.organizationId, orgId)))
        .returning();
      const row = deleted[0];
      if (!row) throw new NotFoundError('Cycle not found');
      await enqueueSearchDelete(orgId, 'cycle', row.id);
      return ok(c, CycleOut, toOut(row));
    },
  )
  .get(
    '/:id/tasks',
    apiDoc({
      tag: 'Cycles',
      summary: 'List cycle tasks',
      response: CycleTasksOut,
      description: `List a cycle's active committed tasks, grouped by a containment axis. The \`groupBy\` query selects the axis — \`project\` (default) buckets tasks by their \`project_id\`, \`program\` buckets by their \`program_id\` — and the response echoes the chosen \`groupBy\`. Exactly one id field is populated per group (\`projectId\` when grouped by project, \`programId\` when by program), and it is \`null\` for the "no project"/"no program" bucket holding tasks not filed under that axis. Only active (non-archived) tasks currently committed to the cycle are returned. The cycle must exist in the caller's org (404 \`Cycle not found\`). Read-only; org membership suffices. Returns {@link CycleTasksOut}.`,
    }),
    zParam(idParam),
    zQuery(CycleTasksQuery),
    async (c) => {
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
    },
  )
  .get(
    '/:id/burnup',
    apiDoc({
      tag: 'Cycles',
      summary: 'Get cycle burn-up',
      response: CycleBurnupOut,
      description: `The cycle's burn-up report — the data behind the "are we on pace?" chart. \`series\` walks every calendar day of the window \`[starts_at, ends_at]\` inclusive (UTC day boundaries); for each day \`planned\` is the cumulative committed capacity KNOWN by that day (it rises as scope is added mid-cycle, which is why this is a burn-UP not a burn-down), \`completed\` is the cumulative effort whose \`completed_at\` falls on or before that day, and \`remaining = planned - completed\` is the open distance to the plan line. \`scopeChanges\` itemizes every task added after \`starts_at\` (its \`taskId\`, when it joined, and the estimate it added), sorted by when it joined. The flat \`capacity\` and \`stats\` mirror {@link CycleStats} so the chart and its summary come from one read. The cycle must exist in the caller's org (404 \`Cycle not found\`). Read-only; org membership suffices. Returns {@link CycleBurnupOut}.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      return ok(c, CycleBurnupOut, await buildCycleBurnupPayload(orgId, id));
    },
  )
  .post(
    '/:id/close',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Cycles',
      summary: 'Close a cycle',
      capability: 'contribute',
      response: CycleClosed,
      description: `Close a cycle with an explicit, reviewed carryover plan — nothing rolls by accident (product §8.5: carryover is reviewed before it rolls). The body's \`carryover\` is a per-task decision list covering the cycle's still-incomplete committed tasks; \`keep\` leaves the task on the now-closed cycle (no write), \`move\` reassigns it to \`targetCycleId\` (required), and \`triage\` detaches it from any cycle (\`cycle_id\` set null), returning it to the team's triage queue. All decisions plus the close are applied in ONE transaction, so the cycle never half-closes. Validation (422, as field errors): every decision must name a task that is currently incomplete AND committed to THIS cycle (a completed task, an unrelated/cross-tenant task id is rejected); a \`move\` target must be a DIFFERENT cycle on the SAME team within the org (never the cycle being closed, never cross-team). After the carryover applies, the cycle's \`status\` is set \`completed\`. Requires \`contribute\`. Returns {@link CycleClosed} \`{ closed: true, keptCount, movedCount, triagedCount }\`. (Note: tasks already done need no decision; only incomplete committed tasks may appear in \`carryover\`.) See \`GET /:id/burnup\` for the pace data informing the review.`,
    }),
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
      const changedTaskIds: string[] = [];

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
            changedTaskIds.push(decision.taskId);
            movedCount += 1;
            continue;
          }

          // 'triage': detach from any cycle, returning the task to the triage queue.
          await tx
            .update(task)
            .set({ cycleId: null })
            .where(and(eq(task.id, decision.taskId), eq(task.organizationId, orgId)));
          changedTaskIds.push(decision.taskId);
          triagedCount += 1;
        }

        await tx
          .update(cycle)
          .set({ status: 'completed' })
          .where(and(eq(cycle.id, id), eq(cycle.organizationId, orgId)));
      });

      await enqueueSearchUpsert(orgId, 'cycle', id);
      await Promise.all(changedTaskIds.map((taskId) => enqueueSearchUpsert(orgId, 'task', taskId)));
      return ok(c, CycleClosed, { closed: true, keptCount, movedCount, triagedCount });
    },
  );

export default cycles;
