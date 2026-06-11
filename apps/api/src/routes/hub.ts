/**
 * `@docket/api` — hub aggregation router (TOP-LEVEL, mounted at `/v1/hub`).
 *
 * @remarks
 * The caller's cross-org command center. Every route resolves the orgs the session user is
 * an active human Actor in and aggregates across them. Read-only projections only — never
 * merges tenant data (fan-out queries per membership, each item carries its own org id).
 */
import { auditEvent, db, notification, program, project, task } from '@docket/db';
import {
  HubActivityOut,
  HubInboxOut,
  HubPortfolioOut,
  HubSearchOut,
  HubTodayOut,
  ListQuery,
} from '@docket/types';
import { and, desc, eq, ilike, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError } from '../error';
import { ok } from '../lib/ok';
import { zQuery } from '../lib/validate';

import { callerOrgIds, toAuditEventOut, toNotificationOut, toSearchHit } from './hub-helpers';
import { buildHubTodayPayload } from './hub-today';
import { buildHubPortfolioPayload } from './hub-portfolio';

const todayQuery = z.object({ date: z.iso.date() });
const portfolioQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  initiativeId: z.string().optional(),
});
const searchQuery = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Hub router: cross-org `today`, `inbox`, `activity`, `portfolio`, and `search` surfaces. */
const hubRouter = new Hono<AppEnv>()
  .get('/today', zQuery(todayQuery), async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const { date } = c.req.valid('query');
    return ok(c, HubTodayOut, await buildHubTodayPayload(session.user.id, date));
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
  .get('/activity', zQuery(ListQuery), async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const { limit, order } = c.req.valid('query');
    const orgIds = await callerOrgIds(session.user.id);
    if (orgIds.length === 0) return ok(c, HubActivityOut, { items: [] });

    const orderBy = order === 'asc' ? auditEvent.createdAt : desc(auditEvent.createdAt);
    const rows = await db
      .select()
      .from(auditEvent)
      .where(inArray(auditEvent.organizationId, orgIds))
      .orderBy(orderBy)
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return ok(c, HubActivityOut, {
      items: page.map(toAuditEventOut),
      ...(hasMore && last ? { nextCursor: last.id } : {}),
    });
  })
  .get('/portfolio', zQuery(portfolioQuery), async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const { from, to, initiativeId } = c.req.valid('query');
    return ok(
      c,
      HubPortfolioOut,
      await buildHubPortfolioPayload(session.user.id, from, to, initiativeId),
    );
  })
  .get('/search', zQuery(searchQuery), async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const { q, limit } = c.req.valid('query');
    const orgIds = await callerOrgIds(session.user.id);
    if (orgIds.length === 0) return ok(c, HubSearchOut, { query: q, results: [] });
    const pattern = `%${q}%`;

    const [taskRows, projectRows, programRows] = await Promise.all([
      db
        .select()
        .from(task)
        .where(and(inArray(task.organizationId, orgIds), ilike(task.title, pattern)))
        .limit(limit),
      db
        .select()
        .from(project)
        .where(and(inArray(project.organizationId, orgIds), ilike(project.name, pattern)))
        .limit(limit),
      db
        .select()
        .from(program)
        .where(and(inArray(program.organizationId, orgIds), ilike(program.name, pattern)))
        .limit(limit),
    ]);

    const results: z.input<typeof HubSearchOut>['results'] = [
      ...taskRows.map((t) => toSearchHit(t.organizationId, 'task', t.id, t.title)),
      ...projectRows.map((p) => toSearchHit(p.organizationId, 'project', p.id, p.name)),
      ...programRows.map((p) => toSearchHit(p.organizationId, 'program', p.id, p.name)),
    ].slice(0, limit);

    return ok(c, HubSearchOut, { query: q, results });
  });

export default hubRouter;
