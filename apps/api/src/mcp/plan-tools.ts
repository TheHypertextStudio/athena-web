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
import { satisfies } from '@docket/authz';
import { actor, dailyPlanItem, db, hub, task } from '@docket/db';
import { and, asc, eq, inArray, isNull, max } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError, ValidationError } from '../error';
import { resourceAccessKey, resolveResourceAccess } from '../permissions/resource-access';
import { buildHubTodayPayload } from '../routes/hub-today';
import { buildTaskViewFilter, type ViewableTaskParts } from '../routes/task-helpers';
import { loadDayCandidates, loadDependencyEdges } from '../services/scheduling/day-plan-repository';
import { planDay, type PlannedTask } from '../services/scheduling/day-planner';
import { loadDayBlocks, loadSchedulingPreferences } from '../services/scheduling/repository';
import type { McpActor, McpContext } from './auth';
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

/** Register the `brief` tool. */
function registerReadDayTool(server: McpRegistrar, ctx: McpContext): void {
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
}

/** Register the `plan_day` tool. */
function registerPlanDayTool(server: McpRegistrar, ctx: McpContext): void {
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
    (input) => runTool(() => planOneDay(ctx, input)),
  );
}

/** The `plan_day` tool's validated input. */
interface PlanDayInput {
  readonly orgId: string;
  readonly date: string;
  readonly autoPlan?: boolean | undefined;
  readonly edits?: readonly PlanEdit[] | undefined;
}

/**
 * Plan one day: optionally auto-place work, then apply the caller's own edits.
 *
 * @remarks
 * Auto-plan runs BEFORE the edits, and that ordering is the whole guarantee that it adds a
 * capability rather than taking one away: whatever the planner decided, a hand edit in the same
 * call lands on top of it.
 *
 * @param ctx - The authenticated MCP caller.
 * @param input - The validated tool input.
 * @returns The day's plan, plus what this call placed and what it could not.
 */
async function planOneDay(ctx: McpContext, input: PlanDayInput) {
  const writes = input.autoPlan === true || (input.edits?.length ?? 0) > 0;
  const actorCtx = await scopedActor(ctx, input.orgId, writes ? 'work:write' : 'work:read');
  await authorize(actorCtx, 'view', { kind: 'organization', id: input.orgId, orgId: input.orgId });
  const { hubId, userId } = await callerHub(ctx);

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
  if (input.edits !== undefined && input.edits.length > 0) {
    const canViewEditedTask = await buildTaskViewFilter(input.orgId, actorCtx.actorId);
    for (const edit of input.edits) {
      if (await applyEdit(hubId, actorCtx, input.date, edit, canViewEditedTask)) applied += 1;
    }
  }
  return jsonResult({
    date: input.date,
    items: await readDay(hubId, userId, input.date),
    applied,
    autoPlanned: auto.autoPlanned,
    unplaced: auto.unplaced,
  });
}

/** One task the day planner could place, as `loadDayCandidates` returns it. */
type DayCandidate = Awaited<ReturnType<typeof loadDayCandidates>>[number];

/**
 * Narrow the day's candidates to the tasks this person may actually edit.
 *
 * @remarks
 * `loadDayCandidates` intentionally answers a scheduling question, not an authorization one.
 * Before its answer becomes a mutation input, every candidate is resolved in one batch: a plan row
 * is still a task edit, so an active human needs current task-level `contribute`, not merely a
 * write token or a non-cascading grant on the organization root.
 *
 * @param userId - The person the plan belongs to.
 * @param candidateRows - Everything the scheduler proposed.
 * @returns The candidates they may contribute to.
 */
async function contributableCandidates(
  userId: string,
  candidateRows: readonly DayCandidate[],
): Promise<DayCandidate[]> {
  if (candidateRows.length === 0) return [];
  const access = await resolveResourceAccess(
    userId,
    candidateRows.map((candidate) => ({
      organizationId: candidate.organizationId,
      kind: 'task' as const,
      id: candidate.taskId,
    })),
  );
  return candidateRows.filter((candidate) => {
    const capability = access.get(
      resourceAccessKey({
        organizationId: candidate.organizationId,
        kind: 'task',
        id: candidate.taskId,
      }),
    )?.effectiveCapability;
    return capability === null || capability === undefined
      ? false
      : satisfies(capability, 'contribute');
  });
}

/**
 * Write one planned task onto the day, inserting or moving its existing row.
 *
 * @param hubId - The Hub whose day this is.
 * @param date - The civil date being planned.
 * @param item - The placement the planner decided.
 * @param rowId - The plan row this task already has, when it has one.
 */
async function writePlanItem(
  hubId: string,
  date: string,
  item: PlannedTask,
  rowId: string | undefined,
): Promise<void> {
  const timebox = {
    timeboxStartsAt: item.start === null ? null : new Date(item.start),
    timeboxEndsAt: item.end === null ? null : new Date(item.end),
  };
  if (rowId === undefined) {
    await db.insert(dailyPlanItem).values({
      hubId,
      refOrganizationId: item.organizationId,
      refTaskId: item.taskId,
      date,
      sort: item.sort,
      ...timebox,
    });
    return;
  }
  await db
    .update(dailyPlanItem)
    .set({ sort: item.sort, ...timebox })
    .where(eq(dailyPlanItem.id, rowId));
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
  const candidateRows = await loadDayCandidates(db, {
    orgId: input.orgId,
    actorId: input.actorId,
    hubId: input.hubId,
    date: input.date,
    timezone: preferences.timezone,
  });
  const candidates = await contributableCandidates(input.userId, candidateRows);
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
    if (item.start !== null) placed += 1;
    await writePlanItem(input.hubId, input.date, item, existing.get(item.taskId));
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
 * @param actorCtx - The caller's authenticated actor in the task's organization.
 * @param date - The day being planned.
 * @param edit - The edit.
 * @param canViewTask - The caller's current bulk visibility predicate for this organization.
 * @returns whether anything actually changed.
 */
async function applyEdit(
  hubId: string,
  actorCtx: McpActor,
  date: string,
  edit: PlanEdit,
  canViewTask: (task: ViewableTaskParts) => boolean,
): Promise<boolean> {
  const orgId = actorCtx.orgId;
  await assertEditableTask(actorCtx, edit.taskId, canViewTask);

  const where = and(
    eq(dailyPlanItem.hubId, hubId),
    eq(dailyPlanItem.refOrganizationId, orgId),
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
    case 'add':
      return existing ? false : appendPlanItem(hubId, orgId, date, edit.taskId);
    case 'remove':
      if (!existing) return false;
      await db.delete(dailyPlanItem).where(where);
      return true;
    case 'timebox':
      if (!existing) throw new NotFoundError('That task is not on this day’s plan');
      await applyTimebox(where, edit);
      return true;
    default:
      return setPlanItemStatus(where, existing?.status, edit.action);
  }
}

/**
 * Refuse a plan edit on a task the caller cannot see or contribute to.
 *
 * @param actorCtx - The authenticated MCP actor.
 * @param taskId - The task the edit names.
 * @param canViewTask - The viewer's task visibility predicate.
 * @throws {NotFoundError} When the task is archived, or invisible to them.
 */
async function assertEditableTask(
  actorCtx: McpActor,
  taskId: string,
  canViewTask: (candidate: ViewableTaskParts) => boolean,
): Promise<void> {
  const orgId = actorCtx.orgId;
  const taskRows = await db
    .select({
      id: task.id,
      teamId: task.teamId,
      projectId: task.projectId,
      programId: task.programId,
      visibility: task.visibility,
    })
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.organizationId, orgId), isNull(task.archivedAt)))
    .limit(1);
  const taskRow = taskRows[0];
  if (!taskRow || !canViewTask(taskRow)) throw new NotFoundError('Task not found');
  await authorize(actorCtx, 'contribute', { kind: 'task', id: taskRow.id, orgId });
}

/**
 * Put one task at the end of the day's plan.
 *
 * @remarks
 * `sort` is server-assigned so a plan holds the order it was built in. Letting it default to 0
 * meant every item tied, and a read with no tiebreaker returned them in whatever order the page
 * came back — a plan that scrambles itself between reads.
 *
 * @param hubId - The Hub whose day this is.
 * @param orgId - The workspace the task belongs to.
 * @param date - The civil date being planned.
 * @param taskId - The task to add.
 * @returns `true`, because adding always changes the plan.
 */
async function appendPlanItem(
  hubId: string,
  orgId: string,
  date: string,
  taskId: string,
): Promise<boolean> {
  const [top] = await db
    .select({ highest: max(dailyPlanItem.sort) })
    .from(dailyPlanItem)
    .where(and(eq(dailyPlanItem.hubId, hubId), eq(dailyPlanItem.date, date)));
  await db.insert(dailyPlanItem).values({
    hubId,
    refOrganizationId: orgId,
    refTaskId: taskId,
    date,
    sort: (top?.highest ?? 0) + 1,
  });
  return true;
}

/**
 * Move one planned task between done and planned.
 *
 * @param where - The predicate selecting that plan row.
 * @param current - The row's current status, when it is on the plan at all.
 * @param action - Which way it is moving.
 * @returns Whether anything changed.
 */
async function setPlanItemStatus(
  where: ReturnType<typeof and>,
  current: string | undefined,
  action: 'complete' | 'reopen',
): Promise<boolean> {
  const next = action === 'complete' ? 'done' : 'planned';
  if (current === undefined || current === next) return false;
  await db.update(dailyPlanItem).set({ status: next }).where(where);
  return true;
}

/**
 * Give one planned task its time window.
 *
 * @param where - The predicate selecting that plan row.
 * @param edit - The timebox edit.
 * @throws {ValidationError} When only one end of the window was given.
 */
async function applyTimebox(where: ReturnType<typeof and>, edit: PlanEdit): Promise<void> {
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
}

/**
 * Read a day's plan, in order.
 *
 * @remarks
 * Ordered by `sort` then `createdAt`, so two items that somehow share a position still come back
 * the same way every time — an unstable plan is worse than a wrong one.
 *
 * @param hubId - The caller's Hub.
 * @param userId - The caller whose active organization memberships authorize each plan row.
 * @param date - The day.
 * @returns the plan lines, with titles resolved.
 */
async function readDay(
  hubId: string,
  userId: string,
  date: string,
): Promise<z.infer<typeof PlanItem>[]> {
  const rows = await db
    .select()
    .from(dailyPlanItem)
    .where(and(eq(dailyPlanItem.hubId, hubId), eq(dailyPlanItem.date, date)))
    .orderBy(asc(dailyPlanItem.sort), asc(dailyPlanItem.createdAt));
  if (rows.length === 0) return [];

  const taskIds = [...new Set(rows.map((row) => row.refTaskId))];
  const organizationIds = [...new Set(rows.map((row) => row.refOrganizationId))];
  const tasks = await db
    .select({
      id: task.id,
      organizationId: task.organizationId,
      title: task.title,
      teamId: task.teamId,
      projectId: task.projectId,
      programId: task.programId,
      visibility: task.visibility,
    })
    .from(task)
    .where(
      and(
        inArray(task.id, taskIds),
        inArray(task.organizationId, organizationIds),
        isNull(task.archivedAt),
      ),
    );
  const tasksByOrganization = new Map<string, Map<string, (typeof tasks)[number]>>();
  for (const taskRow of tasks) {
    let tasksInOrganization = tasksByOrganization.get(taskRow.organizationId);
    if (!tasksInOrganization) {
      tasksInOrganization = new Map();
      tasksByOrganization.set(taskRow.organizationId, tasksInOrganization);
    }
    tasksInOrganization.set(taskRow.id, taskRow);
  }

  // A Hub is cross-organization, so one target-org authorization at the tool boundary cannot
  // authorize every retained pointer. Build one canonical visibility predicate per active human
  // membership and use the pointer's stored organization as the lookup boundary.
  const callerActors = await db
    .select({ organizationId: actor.organizationId, actorId: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.userId, userId),
        inArray(actor.organizationId, organizationIds),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    );
  const canViewByOrganization = new Map(
    await Promise.all(
      callerActors.map(
        async (caller) =>
          [
            caller.organizationId,
            await buildTaskViewFilter(caller.organizationId, caller.actorId),
          ] as const,
      ),
    ),
  );

  return rows.flatMap((row) => {
    const taskRow = tasksByOrganization.get(row.refOrganizationId)?.get(row.refTaskId);
    const canViewTask = canViewByOrganization.get(row.refOrganizationId);
    if (!taskRow || canViewTask?.(taskRow) !== true) return [];
    return [
      {
        taskId: row.refTaskId,
        title: taskRow.title,
        status: row.status,
        sort: row.sort,
        ...(row.timeboxStartsAt ? { startsAt: row.timeboxStartsAt.toISOString() } : {}),
        ...(row.timeboxEndsAt ? { endsAt: row.timeboxEndsAt.toISOString() } : {}),
      },
    ];
  });
}

/** Register the day-planning tools. */
export function registerPlanTools(server: McpRegistrar, ctx: McpContext): void {
  registerReadDayTool(server, ctx);
  registerPlanDayTool(server, ctx);
}
