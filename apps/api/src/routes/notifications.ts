/**
 * `@docket/api` — notifications router (TOP-LEVEL, mounted at `/v1/notifications`).
 *
 * @remarks
 * This is a cross-org surface: every route reads `c.get('session')` directly (NOT
 * `actorCtx`) because the caller's inbox spans every org they belong to. The
 * notification's `userId` is the recipient (the session user id), so rows are filtered
 * by user — never by an org from the client (the optional `organizationId`/`type`
 * filters only narrow WITHIN the caller's own notifications, they never widen scope to
 * another user). A null session throws {@link AuthError}. Notifications are read-only
 * aside from the read/act transitions, all of which converge on the single persisted
 * state column the schema carries: `read_at`.
 */
import { db, notification } from '@docket/db';
import {
  NotificationAct,
  NotificationCount,
  NotificationListQuery,
  NotificationOut,
  NotificationReadAll,
  NotificationReadAllResult,
  pageOf,
} from '@docket/types';
import { and, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { zJson, zParam, zQuery } from '../lib/validate';

type NotificationRow = typeof notification.$inferSelect;

function toOut(n: NotificationRow): z.input<typeof NotificationOut> {
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

const idParam = z.object({ id: z.string() });

/**
 * Build the AND-combined where clause for a caller's inbox.
 *
 * @remarks
 * The `userId` predicate is mandatory and is what enforces ownership/tenant isolation —
 * a caller can only ever touch their own notifications. The remaining predicates are the
 * optional, client-supplied narrowing filters (org/type/unread), each appended only when
 * present so an unfiltered call lists the caller's entire inbox.
 *
 * @param userId - The session user id (the recipient).
 * @param filters - The optional org/type/unread narrowing filters.
 * @returns the combined Drizzle predicate.
 */
function inboxWhere(
  userId: string,
  filters: { organizationId?: string; type?: NotificationRow['type']; unreadOnly?: boolean } = {},
): SQL | undefined {
  const conditions: (SQL | undefined)[] = [eq(notification.userId, userId)];
  if (filters.organizationId !== undefined) {
    conditions.push(eq(notification.organizationId, filters.organizationId));
  }
  if (filters.type !== undefined) conditions.push(eq(notification.type, filters.type));
  if (filters.unreadOnly) conditions.push(isNull(notification.readAt));
  return and(...conditions);
}

/** Notifications router: the caller's cross-org Hub inbox + read/act transitions. */
const notifications = new Hono<AppEnv>()
  .get('/', zQuery(NotificationListQuery), async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const { unreadOnly, organizationId, type } = c.req.valid('query');
    const rows = await db
      .select()
      .from(notification)
      .where(inboxWhere(session.user.id, { unreadOnly, organizationId, type }))
      .orderBy(desc(notification.createdAt));
    return ok(c, pageOf(NotificationOut), { items: rows.map(toOut) });
  })
  .get('/count', async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    // One scan of the caller's unread set; partition by type in memory rather than
    // issuing two COUNT queries (the inbox is small and already user-scoped).
    const rows = await db
      .select({ type: notification.type })
      .from(notification)
      .where(inboxWhere(session.user.id, { unreadOnly: true }));
    const pendingApprovals = rows.filter((r) => r.type === 'approval_request').length;
    return ok(c, NotificationCount, { unread: rows.length, pendingApprovals });
  })
  .post('/read-all', zJson(NotificationReadAll), async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const { organizationId, type } = c.req.valid('json');
    // Only flip rows that are still unread so `updated` reflects the real transition
    // count (re-running read-all is idempotent and reports 0 on the second call).
    const updated = await db
      .update(notification)
      .set({ readAt: new Date() })
      .where(inboxWhere(session.user.id, { organizationId, type, unreadOnly: true }))
      .returning({ id: notification.id });
    return ok(c, NotificationReadAllResult, { updated: updated.length });
  })
  .post('/:id/read', zParam(idParam), async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const { id } = c.req.valid('param');
    const updated = await db
      .update(notification)
      .set({ readAt: new Date() })
      .where(and(eq(notification.id, id), eq(notification.userId, session.user.id)))
      .returning();
    const row = updated[0];
    if (!row) throw new NotFoundError('Notification not found');
    return ok(c, NotificationOut, toOut(row));
  })
  .post('/:id/act', zParam(idParam), zJson(NotificationAct), async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const { id } = c.req.valid('param');
    // Acting on an inbox item handles it — which, in the persisted model, means marking
    // it read (the schema carries no separate `acted_at`). The `action` body names the
    // inline action the client invoked; the resulting state is the read notification.
    const updated = await db
      .update(notification)
      .set({ readAt: new Date() })
      .where(and(eq(notification.id, id), eq(notification.userId, session.user.id)))
      .returning();
    const row = updated[0];
    if (!row) throw new NotFoundError('Notification not found');
    return ok(c, NotificationOut, toOut(row));
  });

export default notifications;
