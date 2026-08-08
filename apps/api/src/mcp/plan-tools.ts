/**
 * `@docket/api` — `brief` and `plan_day`: what needs me, and what I'm doing about it today.
 *
 * @remarks
 * These are the two questions a chief of staff is actually for, and neither was answerable in one
 * call. "What needs my attention?" took four — approvals, blocked, due, inbox — each with its own
 * filters and none of them ranked against the others. Committing to a day took one call per task,
 * with no way to reorder, timebox, or tick anything off.
 *
 * `brief` is backed by the same builder the Hub Today screen uses, so the agent and the app answer
 * the question identically rather than drifting into two definitions of "needs attention".
 *
 * `plan_day` is one call that reads and edits, because a plan is revised in the same breath it is
 * read — "move the review after lunch and drop the third one" should not be three round trips.
 *
 * It also *builds* a day rather than only recording one. With `autoPlan`, the day is produced
 * deterministically by {@link planDay}: the caller's tasks for the day are ordered by a
 * topological sort of the dependency graph — the same `task_dependency` relation the canvas at
 * `/v1/orgs/:orgId/graph` draws — with priority breaking ties only within what dependencies
 * permit, then timeboxed into availability that has already had protected time and everything on
 * the calendar removed. Auto-planning runs *before* the edits, which is what keeps this an added
 * capability rather than a replaced one: the planner proposes, and a hand edit in the same call
 * still wins.
 */
import { dailyPlanItem, db, hub, task } from '@docket/db';
import { and, asc, eq, inArray, max } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError, ValidationError } from '../error';
import { buildHubTodayPayload } from '../routes/hub-today';
import { loadDayCandidates, loadDependencyEdges } from '../services/scheduling/day-plan-repository';
import { planDay } from '../services/scheduling/day-planner';
import { loadDayBlocks, loadSchedulingPreferences } from '../services/scheduling/repository';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { WIDGET, widgetMeta } from './apps';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import { orgIdParam } from './tools-shared';

/** One edit to a day's plan. */
const PlanEdit = z.object({
  action: z
    .enum(['add', 'remove', 'complete', 'reopen', 'timebox'])
    .describe('What to do with this task on this day.'),
  taskId: z.string().min(1).describe('The task, by id.'),
  startsAt: z.iso
    .datetime()
    .optional()
    .describe('When the timebox starts. Required for `timebox`, ignored otherwise.'),
  endsAt: z.iso
    .datetime()
    .optional()
    .describe('When the timebox ends. Required for `timebox`, ignored otherwise.'),
});
/** One edit to a day's plan. */
type PlanEdit = z.infer<typeof PlanEdit>;

/** A task the planner kept on the day but had no time for. */
const PlanUnplaced = z.object({
  taskId: z.string(),
  title: z.string(),
  reason: z.string().describe('Why it got no timebox. Currently only `day_full`.'),
});

/** One line of a day's plan as the caller sees it. */
const PlanItem = z.object({
  taskId: z.string(),
  title: z.string(),
  status: z.string().describe('planned, done, or deferred.'),
  sort: z.number().int().describe('Its position in the day, ascending.'),
  startsAt: z.string().optional().describe('The timebox start, when one is set.'),
  endsAt: z.string().optional().describe('The timebox end, when one is set.'),
});

/**
 * Resolve the caller's Hub, which is where a daily plan lives.
 *
 * @remarks
 * The plan is a personal, cross-org surface keyed to a human's Hub. An agent principal has no Hub,
 * so it cannot plan into one — reported as not-found rather than forbidden, since from the agent's
 * side the thing genuinely does not exist.
 *
 * @param ctx - The authenticated caller.
 * @returns the Hub id and the user it belongs to.
 * @throws {NotFoundError} When the caller is an agent, or has no Hub yet.
 */
export async function callerHub(ctx: McpContext): Promise<{ hubId: string; userId: string }> {
  if (ctx.principal.kind === 'agent') throw new NotFoundError('Hub not found');
  const rows = await db
    .select({ id: hub.id })
    .from(hub)
    .where(eq(hub.userId, ctx.principal.userId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Hub not found');
  return { hubId: row.id, userId: ctx.principal.userId };
}

/** Register `brief` and `plan_day` on `server`. */
export function registerPlanTools(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'brief',
    {
      title: 'Brief',
      description:
        "Everything waiting on the caller for a given day, in one call: today's plan, what is blocked, what is awaiting their approval, what is due, and how much is sitting unread in the inbox. This spans every organization they belong to, because attention does not respect org boundaries. Start here when asked what to work on.",
      inputSchema: {
        date: z.iso
          .date()
          .describe('The day to brief on, as `YYYY-MM-DD`. Ask the caller rather than guessing.'),
      },
      outputSchema: {
        date: z.string(),
        plan: z.array(z.unknown()).describe('What the caller committed to for the day.'),
        calendar: z.array(z.unknown()).describe('Meetings and events on the day.'),
        needsAttention: z
          .object({
            approvals: z.array(z.unknown()).describe('Agent actions awaiting a decision.'),
            blocked: z.array(z.unknown()).describe('Their work that something else is holding up.'),
            dueToday: z.array(z.unknown()).describe('Their work due on the day.'),
            inbox: z.number().int().describe('How many unread inbox items.'),
          })
          .describe('The four things that can be waiting on a person.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        // No `orgId`: the brief is Hub-scoped and deliberately crosses organizations, so the
        // authorization here is identity, and `buildHubTodayPayload` filters to the orgs the
        // caller actually belongs to.
        if (ctx.principal.kind === 'agent') throw new NotFoundError('Hub not found');
        return jsonResult(await buildHubTodayPayload(ctx.principal.userId, input.date));
      }),
  );

  server.registerTool(
    'plan_day',
    {
      title: 'Plan a day',
      description:
        "Read a day's plan and change it in the same call: add tasks, drop them, tick them off, or set a timebox. Set `autoPlan` to build the day first — the planner orders the caller's tasks for the day by dependency then priority, and timeboxes them into their real availability. Edits apply after that, in the order given, so a hand edit always wins. The whole day is returned afterwards so the caller sees the result rather than inferring it. Call with no edits and no `autoPlan` just to read.",
      inputSchema: {
        orgId: orgIdParam,
        date: z.iso.date().describe('The day, as `YYYY-MM-DD`.'),
        autoPlan: z
          .boolean()
          .optional()
          .describe(
            "Build the day deterministically before applying edits: the caller's tasks planned for or due on the day are ordered so nothing precedes what blocks it, then timeboxed into availability that already excludes protected time and anything on the calendar. Re-sequences tasks already on the plan rather than discarding them.",
          ),
        edits: z
          .array(PlanEdit)
          .optional()
          .describe('What to change. Omit to read the day without touching it.'),
      },
      outputSchema: {
        date: z.string(),
        items: z.array(PlanItem).describe('The day, in order, after any edits.'),
        applied: z.number().int().describe('How many edits changed something.'),
        autoPlanned: z
          .number()
          .int()
          .describe('How many tasks the planner placed. Zero unless `autoPlan` was set.'),
        unplaced: z
          .array(PlanUnplaced)
          .describe(
            'Tasks the planner kept on the day but could not give time to, and why. Empty unless the day was over-full.',
          ),
      },
      _meta: widgetMeta(WIDGET.plan),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const writes = input.autoPlan === true || (input.edits?.length ?? 0) > 0;
        const actorCtx = await scopedActor(ctx, input.orgId, writes ? 'work:write' : 'work:read');
        await authorize(actorCtx, 'view', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });
        const { hubId, userId } = await callerHub(ctx);

        // Auto-plan runs BEFORE the edits, and that ordering is the whole guarantee that this
        // adds a capability rather than taking one away: whatever the planner decided, a hand
        // edit in the same call lands on top of it.
        const auto =
          input.autoPlan === true
            ? await autoPlanDay({
                hubId,
                userId,
                orgId: input.orgId,
                actorId: actorCtx.actorId,
                date: input.date,
              })
            : { autoPlanned: 0, unplaced: [] };

        let applied = 0;
        for (const edit of input.edits ?? []) {
          if (await applyEdit(hubId, input.orgId, input.date, edit)) applied += 1;
        }
        return jsonResult({
          date: input.date,
          items: await readDay(hubId, input.date),
          applied,
          autoPlanned: auto.autoPlanned,
          unplaced: auto.unplaced,
        });
      }),
  );
}

/**
 * Build a day from priority, dependencies and real availability, and persist it.
 *
 * @remarks
 * The seam between the two scheduling systems that had never been connected. Availability comes
 * from the same `scheduling_preference` the week planner uses, so protected time is unreachable
 * here for exactly the reason it is unreachable there — it is removed before a pool exists. The
 * blocks the week planner already placed are read as **busy**, so an auto-planned day fits into
 * the week rather than on top of it.
 *
 * Ordering and placement are delegated whole to the pure {@link planDay}; everything this
 * function does is I/O. That split is what lets "the same inputs produce the same day" be a
 * property test rather than an integration test.
 *
 * Persistence is an upsert, never a wipe: a task already on the day keeps its row (and so its
 * `status` — a completed task stays completed) and is re-sequenced and re-timeboxed in place. A
 * task the planner could not fit has its stale timebox cleared rather than left pointing at a
 * slot that no longer exists.
 *
 * @param input - Whose day, which day, and in which organization.
 * @returns how many tasks were placed, and what could not be.
 */
async function autoPlanDay(input: {
  hubId: string;
  userId: string;
  orgId: string;
  actorId: string;
  date: string;
}): Promise<{ autoPlanned: number; unplaced: z.infer<typeof PlanUnplaced>[] }> {
  const preferences = await loadSchedulingPreferences(db, input.hubId);
  const candidates = await loadDayCandidates(db, {
    orgId: input.orgId,
    actorId: input.actorId,
    hubId: input.hubId,
    date: input.date,
    timezone: preferences.timezone,
  });
  if (candidates.length === 0) return { autoPlanned: 0, unplaced: [] };

  const edges = await loadDependencyEdges(
    db,
    input.orgId,
    candidates.map((c) => c.taskId),
  );
  // Everything already on the calendar for the day — the week planner's own blocks included.
  const busy = (await loadDayBlocks(db, input.userId, input.date, preferences.timezone)).map(
    (b) => ({ start: b.start, end: b.end }),
  );

  const result = planDay({
    date: input.date,
    timezone: preferences.timezone,
    windows: preferences.windows,
    busy,
    candidates,
    edges,
  });

  // Hub-wide for the date, because that is the grain the plan is stored at. `plan_day` is
  // org-scoped by its own signature, so a row belonging to another organization is left exactly
  // as it was — it is not this call's to re-sequence. Its `sort` can then tie with one this run
  // assigns, which `readDay` already breaks by `createdAt`, so the day stays stably ordered.
  const existing = new Map(
    (
      await db
        .select({ id: dailyPlanItem.id, refTaskId: dailyPlanItem.refTaskId })
        .from(dailyPlanItem)
        .where(and(eq(dailyPlanItem.hubId, input.hubId), eq(dailyPlanItem.date, input.date)))
    ).map((row) => [row.refTaskId, row.id]),
  );

  let placed = 0;
  for (const item of result.items) {
    const timebox = {
      timeboxStartsAt: item.start === null ? null : new Date(item.start),
      timeboxEndsAt: item.end === null ? null : new Date(item.end),
    };
    if (item.start !== null) placed += 1;

    const rowId = existing.get(item.taskId);
    if (rowId === undefined) {
      await db.insert(dailyPlanItem).values({
        hubId: input.hubId,
        refOrganizationId: item.organizationId,
        refTaskId: item.taskId,
        date: input.date,
        sort: item.sort,
        ...timebox,
      });
      continue;
    }
    await db
      .update(dailyPlanItem)
      .set({ sort: item.sort, ...timebox })
      .where(eq(dailyPlanItem.id, rowId));
  }

  return {
    autoPlanned: placed,
    unplaced: result.unplaced.map((u) => ({
      taskId: u.taskId,
      title: u.title,
      reason: u.reason,
    })),
  };
}

/**
 * Apply one edit to a day.
 *
 * @param hubId - The caller's Hub.
 * @param orgId - The organization the task belongs to.
 * @param date - The day being planned.
 * @param edit - The edit.
 * @returns whether anything actually changed.
 */
async function applyEdit(
  hubId: string,
  orgId: string,
  date: string,
  edit: PlanEdit,
): Promise<boolean> {
  const taskRows = await db
    .select({ id: task.id })
    .from(task)
    .where(and(eq(task.id, edit.taskId), eq(task.organizationId, orgId)))
    .limit(1);
  if (!taskRows[0]) throw new NotFoundError('Task not found');

  const where = and(
    eq(dailyPlanItem.hubId, hubId),
    eq(dailyPlanItem.refTaskId, edit.taskId),
    eq(dailyPlanItem.date, date),
  );
  const existing = (
    await db
      .select({ id: dailyPlanItem.id, status: dailyPlanItem.status })
      .from(dailyPlanItem)
      .where(where)
      .limit(1)
  )[0];

  switch (edit.action) {
    case 'add': {
      if (existing) return false;
      // Server-assigned so a plan holds the order it was built in. Letting `sort` default to 0
      // meant every item tied, and a read with no tiebreaker returned them in whatever order the
      // page came back — a plan that scrambles itself between reads.
      const [top] = await db
        .select({ highest: max(dailyPlanItem.sort) })
        .from(dailyPlanItem)
        .where(and(eq(dailyPlanItem.hubId, hubId), eq(dailyPlanItem.date, date)));
      await db.insert(dailyPlanItem).values({
        hubId,
        refOrganizationId: orgId,
        refTaskId: edit.taskId,
        date,
        sort: (top?.highest ?? 0) + 1,
      });
      return true;
    }
    case 'remove':
      if (!existing) return false;
      await db.delete(dailyPlanItem).where(where);
      return true;
    case 'complete':
      if (!existing || existing.status === 'done') return false;
      await db.update(dailyPlanItem).set({ status: 'done' }).where(where);
      return true;
    case 'reopen':
      if (!existing || existing.status === 'planned') return false;
      await db.update(dailyPlanItem).set({ status: 'planned' }).where(where);
      return true;
    case 'timebox': {
      if (!existing) throw new NotFoundError('That task is not on this day’s plan');
      if (edit.startsAt === undefined || edit.endsAt === undefined) {
        throw new ValidationError(
          new z.ZodError([
            {
              code: 'custom',
              path: ['edits'],
              message: 'A timebox needs both startsAt and endsAt.',
              input: edit.taskId,
            },
          ]),
        );
      }
      await db
        .update(dailyPlanItem)
        .set({ timeboxStartsAt: new Date(edit.startsAt), timeboxEndsAt: new Date(edit.endsAt) })
        .where(where);
      return true;
    }
  }
}

/**
 * Read a day's plan, in order.
 *
 * @remarks
 * Ordered by `sort` then `createdAt`, so two items that somehow share a position still come back
 * the same way every time — an unstable plan is worse than a wrong one.
 *
 * @param hubId - The caller's Hub.
 * @param date - The day.
 * @returns the plan lines, with titles resolved.
 */
async function readDay(hubId: string, date: string): Promise<z.infer<typeof PlanItem>[]> {
  const rows = await db
    .select()
    .from(dailyPlanItem)
    .where(and(eq(dailyPlanItem.hubId, hubId), eq(dailyPlanItem.date, date)))
    .orderBy(asc(dailyPlanItem.sort), asc(dailyPlanItem.createdAt));
  if (rows.length === 0) return [];

  const titles = new Map(
    (
      await db
        .select({ id: task.id, title: task.title })
        .from(task)
        .where(
          inArray(
            task.id,
            rows.map((row) => row.refTaskId),
          ),
        )
    ).map((row) => [row.id, row.title]),
  );

  return rows.map((row) => ({
    taskId: row.refTaskId,
    title: titles.get(row.refTaskId) ?? row.refTaskId,
    status: row.status,
    sort: row.sort,
    ...(row.timeboxStartsAt ? { startsAt: row.timeboxStartsAt.toISOString() } : {}),
    ...(row.timeboxEndsAt ? { endsAt: row.timeboxEndsAt.toISOString() } : {}),
  }));
}
