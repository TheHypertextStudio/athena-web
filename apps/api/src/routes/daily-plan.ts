/**
 * `@docket/api` — daily-plan router (TOP-LEVEL, mounted at `/v1/daily-plan`).
 *
 * @remarks
 * A cross-org, personal surface: it reads `c.get('session')` directly (NOT `actorCtx`)
 * and resolves the caller's {@link hub} via `hub.userId = session.user.id`. Items
 * reference a Task in any org the caller is a human Actor in; on create the referenced
 * `(refOrganizationId, refTaskId)` is verified to belong to the caller's orgs and to
 * exist, else a 404 (existence-hiding). A null session throws {@link AuthError}.
 */
import { actor, db, dailyPlanItem, hub, task } from '@docket/db';
import { DailyPlanItemCreate, DailyPlanItemOut, DailyPlanItemUpdate, pageOf } from '@docket/types';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { zJson, zParam, zQuery } from '../lib/validate';

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

/** The org ids the user is a human Actor in (their cross-org scope). */
async function callerOrgIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ organizationId: actor.organizationId })
    .from(actor)
    .where(and(eq(actor.userId, userId), eq(actor.kind, 'human')));
  return rows.map((r) => r.organizationId);
}

const listQuery = z.object({ date: z.iso.date() });
const idParam = z.object({ id: z.string() });

/** Daily-plan router: the caller's Hub daily plan for a date + add/update/remove items. */
const dailyPlan = new Hono<AppEnv>()
  .get('/', zQuery(listQuery), async (c) => {
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
  })
  .post('/', zJson(DailyPlanItemCreate), async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const body = c.req.valid('json');
    const hubId = await resolveHubId(session.user.id);

    const orgIds = await callerOrgIds(session.user.id);
    if (!orgIds.includes(body.refOrganizationId)) throw new NotFoundError('Task not found');
    const taskRows = await db
      .select({ id: task.id })
      .from(task)
      .where(and(eq(task.id, body.refTaskId), eq(task.organizationId, body.refOrganizationId)))
      .limit(1);
    if (!taskRows[0]) throw new NotFoundError('Task not found');

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
    return ok(c, DailyPlanItemOut, toOut(row));
  })
  .patch('/:id', zParam(idParam), zJson(DailyPlanItemUpdate), async (c) => {
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
  })
  .delete('/:id', zParam(idParam), async (c) => {
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
  });

export default dailyPlan;
