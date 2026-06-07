/**
 * `@docket/api` — hub aggregation router (TOP-LEVEL, mounted at `/v1/hub`).
 *
 * @remarks
 * The caller's cross-org command center. Every route reads `c.get('session')` directly
 * (NOT `actorCtx`), resolves the orgs the session user is a human Actor in, and
 * aggregates across them — returning org-chipped items (each carries its originating
 * `organizationId`). A null session throws {@link AuthError}; an empty org set yields
 * empty aggregations. These are read-only projections.
 */
import { actor, db, dailyPlanItem, hub, notification, project, task } from '@docket/db';
import type { HubProjectItem, HubTaskItem, NotificationOut } from '@docket/types';
import { HubInboxOut, HubPortfolioOut, HubSearchOut, HubTodayOut } from '@docket/types';
import { and, desc, eq, ilike, inArray, notInArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError } from '../error';
import { ok } from '../lib/ok';
import { zQuery } from '../lib/validate';

type TaskRow = typeof task.$inferSelect;
type ProjectRow = typeof project.$inferSelect;
type NotificationRow = typeof notification.$inferSelect;

function toTaskItem(t: TaskRow): z.input<typeof HubTaskItem> {
  return {
    id: t.id,
    organizationId: t.organizationId,
    title: t.title,
    state: t.state,
    priority: t.priority,
    assigneeId: t.assigneeId,
    projectId: t.projectId,
    dueDate: t.dueDate?.toISOString() ?? null,
  };
}

function toProjectItem(p: ProjectRow): z.input<typeof HubProjectItem> {
  return {
    id: p.id,
    organizationId: p.organizationId,
    name: p.name,
    status: p.status,
    health: p.health,
    targetDate: p.targetDate?.toISOString() ?? null,
  };
}

function toNotificationOut(n: NotificationRow): z.input<typeof NotificationOut> {
  return {
    id: n.id,
    userId: n.userId,
    organizationId: n.organizationId,
    type: n.type,
    body: n.body,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

/** The org ids the user is a human Actor in (their cross-org scope). */
async function callerOrgIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ organizationId: actor.organizationId })
    .from(actor)
    .where(and(eq(actor.userId, userId), eq(actor.kind, 'human')));
  return rows.map((r) => r.organizationId);
}

const todayQuery = z.object({ date: z.iso.date() });
const searchQuery = z.object({ q: z.string().min(1) });

/** Hub router: cross-org `today`, `inbox`, `portfolio`, and `search` aggregations. */
const hubRouter = new Hono<AppEnv>()
  .get('/today', zQuery(todayQuery), async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const { date } = c.req.valid('query');
    const orgIds = await callerOrgIds(session.user.id);
    if (orgIds.length === 0) return ok(c, HubTodayOut, { date, tasks: [] });

    // The caller's Hub daily-plan task refs for the date, plus any task due that date.
    const hubRows = await db
      .select({ id: hub.id })
      .from(hub)
      .where(eq(hub.userId, session.user.id))
      .limit(1);
    const hubId = hubRows[0]?.id;
    const plannedTaskIds = hubId
      ? (
          await db
            .select({ refTaskId: dailyPlanItem.refTaskId })
            .from(dailyPlanItem)
            .where(and(eq(dailyPlanItem.hubId, hubId), eq(dailyPlanItem.date, date)))
        ).map((r) => r.refTaskId)
      : [];

    const planned =
      plannedTaskIds.length > 0
        ? await db
            .select()
            .from(task)
            .where(and(inArray(task.organizationId, orgIds), inArray(task.id, plannedTaskIds)))
        : [];

    const dueRows =
      plannedTaskIds.length > 0
        ? await db
            .select()
            .from(task)
            .where(
              and(
                inArray(task.organizationId, orgIds),
                eq(task.dueDate, new Date(date)),
                notInArray(task.id, plannedTaskIds),
              ),
            )
        : await db
            .select()
            .from(task)
            .where(and(inArray(task.organizationId, orgIds), eq(task.dueDate, new Date(date))));

    const tasks = [...planned, ...dueRows].map(toTaskItem);
    return ok(c, HubTodayOut, { date, tasks });
  })
  .get('/inbox', async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const rows = await db
      .select()
      .from(notification)
      .where(eq(notification.userId, session.user.id))
      .orderBy(desc(notification.createdAt));
    return ok(c, HubInboxOut, { items: rows.map(toNotificationOut) });
  })
  .get('/portfolio', async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const orgIds = await callerOrgIds(session.user.id);
    if (orgIds.length === 0) return ok(c, HubPortfolioOut, { projects: [] });
    const rows = await db
      .select()
      .from(project)
      .where(and(inArray(project.organizationId, orgIds), eq(project.status, 'active')))
      .orderBy(desc(project.createdAt));
    return ok(c, HubPortfolioOut, { projects: rows.map(toProjectItem) });
  })
  .get('/search', zQuery(searchQuery), async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const { q } = c.req.valid('query');
    const orgIds = await callerOrgIds(session.user.id);
    if (orgIds.length === 0) return ok(c, HubSearchOut, { query: q, tasks: [], projects: [] });
    const pattern = `%${q}%`;
    const taskRows = await db
      .select()
      .from(task)
      .where(and(inArray(task.organizationId, orgIds), ilike(task.title, pattern)));
    const projectRows = await db
      .select()
      .from(project)
      .where(and(inArray(project.organizationId, orgIds), ilike(project.name, pattern)));
    return ok(c, HubSearchOut, {
      query: q,
      tasks: taskRows.map(toTaskItem),
      projects: projectRows.map(toProjectItem),
    });
  });

export default hubRouter;
