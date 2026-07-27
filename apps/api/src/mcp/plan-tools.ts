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
 */
import { dailyPlanItem, db, hub, task } from '@docket/db';
import { and, asc, eq, inArray, max } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError, ValidationError } from '../error';
import { buildHubTodayPayload } from '../routes/hub-today';
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
async function callerHub(ctx: McpContext): Promise<{ hubId: string; userId: string }> {
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
        "Read a day's plan and change it in the same call: add tasks, drop them, tick them off, or set a timebox. Edits apply in the order given, and the whole day is returned afterwards so the caller sees the result rather than inferring it. Call with no edits just to read.",
      inputSchema: {
        orgId: orgIdParam,
        date: z.iso.date().describe('The day, as `YYYY-MM-DD`.'),
        edits: z
          .array(PlanEdit)
          .optional()
          .describe('What to change. Omit to read the day without touching it.'),
      },
      outputSchema: {
        date: z.string(),
        items: z.array(PlanItem).describe('The day, in order, after any edits.'),
        applied: z.number().int().describe('How many edits changed something.'),
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
        const actorCtx = await scopedActor(
          ctx,
          input.orgId,
          input.edits && input.edits.length > 0 ? 'work:write' : 'work:read',
        );
        await authorize(actorCtx, 'view', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });
        const { hubId } = await callerHub(ctx);

        let applied = 0;
        for (const edit of input.edits ?? []) {
          if (await applyEdit(hubId, input.orgId, input.date, edit)) applied += 1;
        }
        return jsonResult({ date: input.date, items: await readDay(hubId, input.date), applied });
      }),
  );
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
