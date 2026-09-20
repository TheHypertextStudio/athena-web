/** `@docket/api` — cycles router (mounted at `/v1/orgs/:orgId/cycles`). */
import { cycle, db, task, team } from '@docket/db';
import {
  CycleBackfillOut,
  CycleBurnupOut,
  CycleClosed,
  CycleCloseBody,
  CycleCreate,
  CycleDetail,
  CycleEnsureBody,
  CycleEnsureOut,
  CycleOut,
  CycleTasksOut,
  CycleTasksQuery,
  CycleUpdate,
  CycleWindow,
  CycleWindowQuery,
} from '@docket/work/cycle-contract';
import { CursorQuery, pageOf } from '../contracts/pagination';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../error';
import { CycleRangeLimitError, isWithinWindow } from '../lib/cycle-window';
import { labelsForSubjects } from '../lib/labels';
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';

import { pageResult, seekAfter } from '../lib/list-cursor';
import {
  committedTasks,
  committedTasksForCycles,
  computeStats,
  ensureCycleRange,
  ensureCycleWindow,
  ensureOrgCycleWindows,
  hasActiveLinkedCycle,
  idParam,
  isCompleted,
  loadCycle,
  loadTeam,
  taskToOut,
  toOut,
} from './cycle-helpers';
import { backfillCycleBacklog } from './cycle-backfill';
import { buildCycleBurnupPayload } from './cycle-burnup';
import { buildTaskViewFilter } from './task-helpers';

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
      description: `List the organization's cycles, newest first. Each {@link CycleDetail} includes pace statistics and an \`isCurrent\` flag. Docket calculates task-based statistics after applying the caller's task visibility. Pages default to 50 items and accept at most 100. Reuse a cursor only with the same \`roll\` value. Set \`roll=true\` to create any missing past, current, and upcoming cycle slots before listing them; omit it for a read-only request. Returns a page of {@link CycleDetail}.`,
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

      const rows = await db
        .select()
        .from(cycle)
        .where(and(eq(cycle.organizationId, orgId), seekAfter(cycle.startsAt, cycle.id, cursor)))
        .orderBy(desc(cycle.startsAt), desc(cycle.id))
        .limit(limit + 1);
      const { items: pageRows, nextCursor } = pageResult(rows, limit, (r) => r.startsAt);

      // Roll up each cycle's pace stats inline so callers render a complete roster without a
      // per-cycle fan-out — the committed tasks for the page's cycles are fetched in a single
      // batched query, then folded through the same pure `computeStats` the detail endpoint uses.
      // Each item also surfaces the date-derived `isCurrent`.
      const tasksByCycle = await committedTasksForCycles(
        orgId,
        pageRows.map((r) => r.id),
      );
      const canView = await buildTaskViewFilter(orgId, actorId);
      const items: z.input<typeof CycleDetail>[] = pageRows.map((r) => ({
        ...toOut(r, now),
        stats: computeStats(r, (tasksByCycle.get(r.id) ?? []).filter(canView)),
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
      description: `Return a team's rolling cycle window and identify the cycle that contains today. The required \`teamId\` must identify a team in the organization. Docket creates missing past, current, and upcoming slots from the team's 1–365 day cadence and calendar-date anchor, while preserving manual cycles. Repeating the request does not duplicate slots. The response includes \`cadenceDays\`, \`cadenceAnchor\`, every cycle's \`isCurrent\` value, and the current cycle separately. Returns {@link CycleWindow}.`,
    }),
    zQuery(CycleWindowQuery),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { teamId } = c.req.valid('query');
      const now = new Date();

      // Auto-roll: lazily ensure the rolling window exists for the team (idempotent), then
      // derive the current cycle by date. The team must belong to the org (404 otherwise).
      const teamRow = await loadTeam(orgId, teamId);
      const rows = await ensureCycleWindow(orgId, teamRow, actorId, now);

      // The current cycle is whichever window contains today; on the (impossible for
      // auto-rolled, possible for overlapping manual) tie, the earliest-starting wins.
      const current =
        rows
          .filter((r) => isWithinWindow(now, r.startsAt, r.endsAt))
          .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0] ?? null;

      const payload: z.input<typeof CycleWindow> = {
        teamId,
        cadenceDays: teamRow.cycleCadenceDays,
        cadenceAnchor: teamRow.cycleCadenceAnchor,
        current: current ? toOut(current, now) : null,
        cycles: rows.map((r) => toOut(r, now)),
      };
      return ok(c, CycleWindow, payload);
    },
  )
  .post(
    '/ensure',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Cycles',
      summary: 'Generate cycles through a date',
      capability: 'contribute',
      response: CycleEnsureOut,
      description: `Create each native cycle window that intersects the inclusive date range. The team must belong to this organization and must not use a provider-owned cycle schedule. \`fromDate\` defaults to the team's cadence anchor, and both dates must be on or after that anchor.

One request can create at most 400 cycle windows. Use adjacent date ranges to create more. Repeating the same request or sending overlapping requests does not create duplicate cycles.`,
    }),
    zJson(CycleEnsureBody),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const body = c.req.valid('json');
      const teamRow = await loadTeam(orgId, body.teamId);
      if (await hasActiveLinkedCycle(orgId, teamRow.id)) {
        throw new ConflictError('Cycle cadence is managed by its provider');
      }

      const fromDate = body.fromDate ?? teamRow.cycleCadenceAnchor;
      if (fromDate < teamRow.cycleCadenceAnchor) {
        throw new ValidationError([
          { path: ['fromDate'], message: 'fromDate must be on or after the cadence anchor' },
        ]);
      }
      if (body.throughDate < fromDate) {
        throw new ValidationError([
          { path: ['throughDate'], message: 'throughDate must be on or after fromDate' },
        ]);
      }

      try {
        const rows = await ensureCycleRange({
          orgId,
          teamRow,
          actorId,
          fromDate,
          throughDate: body.throughDate,
          now: new Date(),
        });
        return ok(c, CycleEnsureOut, { items: rows.map((row) => toOut(row)) });
      } catch (error) {
        if (error instanceof CycleRangeLimitError) {
          throw new ValidationError([{ path: ['throughDate'], message: error.message }]);
        }
        throw error;
      }
    },
  )
  .post(
    '/',
    capabilityGuard('contribute'),
    apiDoc({
      status: 201,
      tag: 'Cycles',
      summary: 'Create a cycle',
      capability: 'contribute',
      response: CycleOut,
      description: `Create a cycle for a team instead of waiting for the team's next automatic cycle. The required \`teamId\` must identify a team in this organization. Otherwise, the request returns 404. Supply a team-local \`number\`, \`startsAt\`, and \`endsAt\`; \`name\` is optional and \`status\` defaults to \`upcoming\`. A team cannot have two cycles with the same number. Requires \`contribute\`. The response contains the created {@link CycleOut} without calculated \`stats\`; use \`GET /:id\` to retrieve those statistics.`,
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
      return created(c, CycleOut, toOut(row));
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Cycles',
      summary: 'Get cycle detail',
      response: CycleDetail,
      description: `Fetch a single cycle plus its rolled-up pace \`stats\` — the "are we on pace?" banner. The cycle must exist in the caller's org (404 \`Cycle not found\`). \`stats\` is computed from the active committed tasks the caller can view: \`committed\` (tasks currently on the cycle), \`completed\` (those with a \`completed_at\`), \`capacity\` (sum of committed estimates, unestimated = 0), \`completedCapacity\` (estimate sum of the completed subset), \`scopeChange\` (tasks added after \`starts_at\`, i.e. mid-cycle scope creep), and \`carryover\` (still-incomplete committed tasks — what would roll if the cycle closed now). The response also carries the date-derived \`isCurrent\`. Read-only; organization membership accesses the cycle while its stats use canonical task visibility. Returns {@link CycleDetail}. See \`GET /:id/burnup\` for the daily series and \`GET /:id/tasks\` for the grouped task list.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const row = await loadCycle(orgId, id);
      const canView = await buildTaskViewFilter(orgId, actorId);
      const tasks = (await committedTasks(orgId, id)).filter(canView);
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
      description: `Delete a cycle. Tasks in the cycle are kept and become unscheduled. If the cycle belongs to the rolling window, a later request that rolls cycles forward may create that numbered cycle again. Use \`POST /:id/close\` when you need to review and move unfinished work. Requires the \`contribute\` capability and returns the deleted {@link CycleOut}.`,
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
      description: `List the active tasks committed to a cycle. Set \`groupBy\` to \`project\` (the default) or \`program\`; the response echoes the chosen value. Each group includes either \`projectId\` or \`programId\`. The ID is null for tasks that do not belong to that kind of container. Docket applies the caller's task visibility, and an absent or inaccessible cycle returns 404. Returns {@link CycleTasksOut}.`,
    }),
    zParam(idParam),
    zQuery(CycleTasksQuery),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { groupBy = 'project' } = c.req.valid('query');
      await loadCycle(orgId, id);
      const canView = await buildTaskViewFilter(orgId, actorId);
      const tasks = (await committedTasks(orgId, id)).filter(canView);

      // Group committed tasks by the requested containment axis (Project or Program).
      // The bucket key is the entity id, or `null` for the no-project/no-program bucket.
      const buckets = new Map<string | null, (typeof tasks)[number][]>();
      for (const t of tasks) {
        const key = groupBy === 'project' ? t.projectId : t.programId;
        const list = buckets.get(key);
        if (list) list.push(t);
        else buckets.set(key, [t]);
      }

      // One batched read for every committed task, rather than one per row while grouping.
      const labelsByTask = await labelsForSubjects(
        'task',
        orgId,
        tasks.map((t) => t.id),
      );

      const groups: z.input<typeof CycleTasksOut>['groups'] = [...buckets.entries()].map(
        ([key, list]) => ({
          ...(groupBy === 'project' ? { projectId: key } : { programId: key }),
          tasks: list.map((t) => taskToOut(t, labelsByTask.get(t.id) ?? [])),
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
      description: `Return burn-up data for every UTC calendar day from \`startsAt\` through \`endsAt\`, inclusive. For each day, \`planned\` is cumulative visible task capacity, \`completed\` is cumulative effort completed by that day, and \`remaining\` is \`planned - completed\`. Planned capacity increases when visible work joins the cycle.

\`scopeChanges\` lists visible tasks added after the cycle started, ordered by addition time, with the estimate each task added. \`capacity\` and \`stats\` contain the corresponding summary. An unavailable cycle returns 404, and task-derived values include only tasks the caller can view.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      return ok(c, CycleBurnupOut, await buildCycleBurnupPayload(orgId, id, actorId));
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
      description: `Close a cycle and decide what happens to each unfinished task. Use \`keep\` to leave a task in the completed cycle, \`move\` with \`targetCycleId\` to place it in another cycle on the same team, or \`triage\` to return it to the team's triage queue. Every decision and the cycle close succeed together or fail together. Completed tasks need no decision. Requires the \`contribute\` capability. Returns {@link CycleClosed} with the number of tasks kept, moved, and returned to triage. See \`GET /:id/burnup\` for pace data.`,
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
  )
  .post(
    '/:id/backfill',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Cycles',
      summary: 'Assign backlog tasks to a cycle',
      capability: 'contribute',
      response: CycleBackfillOut,
      description: `Assign the team's active tasks that do not have a cycle to this cycle. Tasks already assigned to any cycle remain unchanged. Completed and canceled tasks are excluded.

Repeating the request affects only tasks that still have no cycle. The response contains \`assignedCount\`. An unavailable cycle returns 404.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { taskIds } = await backfillCycleBacklog(orgId, id);
      await enqueueSearchUpsert(orgId, 'cycle', id);
      await Promise.all(taskIds.map((taskId) => enqueueSearchUpsert(orgId, 'task', taskId)));
      return ok(c, CycleBackfillOut, { assignedCount: taskIds.length });
    },
  );

export default cycles;
