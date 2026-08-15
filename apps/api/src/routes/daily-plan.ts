/**
 * `@docket/api` — daily-plan router (TOP-LEVEL, mounted at `/v1/daily-plan`).
 *
 * @remarks
 * A cross-org, personal surface: it reads `c.get('session')` directly (NOT `actorCtx`)
 * and resolves the caller's {@link hub} via `hub.userId = session.user.id`. Items
 * reference a Task in any org where the caller is an active, unarchived human Actor. On create,
 * the referenced `(refOrganizationId, refTaskId)` must be currently viewable through the canonical
 * task grant/visibility resolver, else a 404 (existence-hiding). A null session throws
 * {@link AuthError}.
 */
import { actor, db, dailyPlanItem, hub, task } from '@docket/db';
import { DailyPlanItemCreate, DailyPlanItemOut, DailyPlanItemUpdate, pageOf } from '@docket/types';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError, NotFoundError } from '../error';
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { buildTaskViewFilter } from './task-helpers';

type DailyPlanItemRow = typeof dailyPlanItem.$inferSelect;

function toOut(d: DailyPlanItemRow): z.input<typeof DailyPlanItemOut> {
  return {
    id: d.id,
    refOrganizationId: d.refOrganizationId,
    refTaskId: d.refTaskId,
    date: d.date,
    sort: d.sort,
    status: d.status,
    timeboxStartsAt: d.timeboxStartsAt?.toISOString() ?? null,
    timeboxEndsAt: d.timeboxEndsAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

/** Resolve (or 404) the caller's Hub id from the session user. */
async function resolveHubId(userId: string): Promise<string> {
  const rows = await db.select({ id: hub.id }).from(hub).where(eq(hub.userId, userId)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Hub not found');
  return row.id;
}

/**
 * Assert that the session user is an active human viewer of this current, in-org Task.
 *
 * A daily-plan row is only a personal pointer, so creating one cannot grant access to the
 * referenced work. Reuse the task visibility resolver rather than reproducing grant semantics.
 */
async function requireViewableTask(
  userId: string,
  organizationId: string,
  taskId: string,
): Promise<void> {
  const callerRows = await db
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.userId, userId),
        eq(actor.organizationId, organizationId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .limit(1);
  const caller = callerRows[0];
  if (!caller) throw new NotFoundError('Task not found');

  const taskRows = await db
    .select({
      id: task.id,
      teamId: task.teamId,
      projectId: task.projectId,
      programId: task.programId,
      visibility: task.visibility,
    })
    .from(task)
    .where(
      and(eq(task.id, taskId), eq(task.organizationId, organizationId), isNull(task.archivedAt)),
    )
    .limit(1);
  const taskRow = taskRows[0];
  if (!taskRow) throw new NotFoundError('Task not found');

  const canView = await buildTaskViewFilter(organizationId, caller.id);
  if (!canView(taskRow)) throw new NotFoundError('Task not found');
}

const listQuery = z.object({ date: z.iso.date() });
const idParam = z.object({ id: z.string() });

/** Daily-plan router: the caller's Hub daily plan for a date + add/update/remove items. */
const dailyPlan = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'DailyPlan',
      summary: 'Get the daily plan',
      response: pageOf(DailyPlanItemOut),
      description: `Return the caller's personal daily plan for a single calendar \`date\` (required query param), ordered by \`sort\` ascending. The daily plan is a **cross-org, Hub-scoped** surface: each item references a Task in any of the orgs the caller is a human Actor in, pulled together into one prioritized list for the day. The owning Hub is resolved server-side from the session user (\`hub.userId = session.user.id\`); items are filtered to \`(hubId, date)\`, so the caller only ever sees their own plan.

Session-only, no capability. 401 when unauthenticated; **404 (Hub not found)** if the session user has no Hub row. Side-effect-free read. Related: \`POST /\` to add an item, \`PATCH /:id\` to reorder/complete/timebox, \`DELETE /:id\` to remove; \`GET /hub/today\` folds this plan into the cross-org Today cockpit.`,
    }),
    zQuery(listQuery),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { date } = c.req.valid('query');
      const hubId = await resolveHubId(session.user.id);
      const rows = await db
        .select()
        .from(dailyPlanItem)
        .where(and(eq(dailyPlanItem.hubId, hubId), eq(dailyPlanItem.date, date)))
        .orderBy(asc(dailyPlanItem.sort));
      return ok(c, pageOf(DailyPlanItemOut), { items: rows.map(toOut) });
    },
  )
  .post(
    '/',
    apiDoc({
      status: 201,
      tag: 'DailyPlan',
      summary: 'Add a daily-plan item',
      response: DailyPlanItemOut,
      description: `Pull a Task into the caller's daily plan for a date, creating a new daily-plan item. The body supplies the task reference \`(refOrganizationId, refTaskId)\`, the \`date\`, and optional \`sort\` position and timebox window. **The Task reference is authorized before insert:** the caller must be an active, unarchived human Actor in \`refOrganizationId\`, and the current Task must pass the canonical task grant/visibility resolver for that Actor. A failure returns **404 (Task not found)** — a single existence-hiding error that never reveals whether the membership, task, or grant was the problem, and never lets the caller create a pointer to work they cannot view.

The owning \`hubId\` is resolved server-side from the session user and is never accepted from the body. **Side effect:** inserts a \`dailyPlanItem\` row (status defaults to \`planned\`); the new item then appears in \`GET /daily-plan\` and the Hub Today cockpit. Session-only, no capability; 401 when unauthenticated, 404 if the caller has no Hub. Related: \`PATCH /:id\`, \`DELETE /:id\`.`,
    }),
    zJson(DailyPlanItemCreate),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const body = c.req.valid('json');
      const hubId = await resolveHubId(session.user.id);

      await requireViewableTask(session.user.id, body.refOrganizationId, body.refTaskId);

      const inserted = await db
        .insert(dailyPlanItem)
        .values({
          hubId,
          refOrganizationId: body.refOrganizationId,
          refTaskId: body.refTaskId,
          date: body.date,
          ...(body.sort !== undefined ? { sort: body.sort } : {}),
          ...(body.timeboxStartsAt !== undefined
            ? { timeboxStartsAt: body.timeboxStartsAt ? new Date(body.timeboxStartsAt) : null }
            : {}),
          ...(body.timeboxEndsAt !== undefined
            ? { timeboxEndsAt: body.timeboxEndsAt ? new Date(body.timeboxEndsAt) : null }
            : {}),
        })
        .returning();
      const row = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
      if (!row) throw new Error('daily plan item insert returned no row');
      return created(c, DailyPlanItemOut, toOut(row));
    },
  )
  .patch(
    '/:id',
    apiDoc({
      tag: 'DailyPlan',
      summary: 'Update a daily-plan item',
      response: DailyPlanItemOut,
      description: `Update a daily-plan item's lifecycle: mark it \`done\`/\`planned\` (\`status\`), reorder it within the day (\`sort\`), or set/clear its calendar timebox (\`timeboxStartsAt\`/\`timeboxEndsAt\`). All body fields are optional — only the keys present are written, so this is a partial update; a null timebox value clears that side of the window. The task reference and date are immutable here (remove and re-add to retarget).

**Ownership is enforced first:** the item must exist under the caller's own Hub (\`(id, hubId)\`), else **404 (Daily plan item not found)** — a caller cannot patch another person's plan item. The status/timebox changes flow into \`GET /daily-plan\` and the Hub Today calendar pane. Session-only, no capability; 401 when unauthenticated, 404 if the caller has no Hub or the item isn't theirs.`,
    }),
    zParam(idParam),
    zJson(DailyPlanItemUpdate),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const hubId = await resolveHubId(session.user.id);

      const existing = await db
        .select({ id: dailyPlanItem.id })
        .from(dailyPlanItem)
        .where(and(eq(dailyPlanItem.id, id), eq(dailyPlanItem.hubId, hubId)))
        .limit(1);
      if (!existing[0]) throw new NotFoundError('Daily plan item not found');

      const updated = await db
        .update(dailyPlanItem)
        .set({
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.sort !== undefined ? { sort: body.sort } : {}),
          ...(body.timeboxStartsAt !== undefined
            ? { timeboxStartsAt: body.timeboxStartsAt ? new Date(body.timeboxStartsAt) : null }
            : {}),
          ...(body.timeboxEndsAt !== undefined
            ? { timeboxEndsAt: body.timeboxEndsAt ? new Date(body.timeboxEndsAt) : null }
            : {}),
        })
        .where(and(eq(dailyPlanItem.id, id), eq(dailyPlanItem.hubId, hubId)))
        .returning();
      const row = updated[0];
      /* v8 ignore next -- @preserve defensive: the daily-plan item was verified to exist above */
      if (!row) throw new NotFoundError('Daily plan item not found');
      return ok(c, DailyPlanItemOut, toOut(row));
    },
  )
  .delete(
    '/:id',
    apiDoc({
      tag: 'DailyPlan',
      summary: 'Remove a daily-plan item',
      response: DailyPlanItemOut,
      description: `Remove a Task from the caller's daily plan. **Side effect:** hard-deletes the \`dailyPlanItem\` row and returns the deleted item's representation (so the client can confirm/undo). This only unplans the Task for that day — the underlying Task in its org is untouched; the daily-plan item is purely a personal, Hub-scoped pointer.

The delete is constrained to the caller's own Hub (\`(id, hubId)\`); an item that isn't theirs (or a missing id) returns **404 (Daily plan item not found)**. Session-only, no capability; 401 when unauthenticated, 404 if the caller has no Hub.`,
    }),
    zParam(idParam),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { id } = c.req.valid('param');
      const hubId = await resolveHubId(session.user.id);
      const deleted = await db
        .delete(dailyPlanItem)
        .where(and(eq(dailyPlanItem.id, id), eq(dailyPlanItem.hubId, hubId)))
        .returning();
      const row = deleted[0];
      if (!row) throw new NotFoundError('Daily plan item not found');
      return ok(c, DailyPlanItemOut, toOut(row));
    },
  );

export default dailyPlan;
