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
import { apiDoc } from '../lib/openapi-route';
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
  .get(
    '/',
    apiDoc({
      tag: 'Notifications',
      summary: 'List notifications',
      response: pageOf(NotificationOut),
      description: `List the signed-in person's notifications across **every organization they belong to**, newest first. This is a cross-org personal surface: it reads the session directly (not an org-scoped actor context), and tenant isolation is enforced by a mandatory \`userId = session.user.id\` predicate — the recipient is always the caller. The optional \`organizationId\`, \`type\`, and \`unreadOnly\` query filters only **narrow within** the caller's own inbox (AND-combined); they can never widen scope to another user's notifications or to an org the caller isn't a member of.

A notification is a read-only message aside from the read/act transitions, all of which converge on the single persisted \`readAt\` column. No capability is required — an authenticated session is sufficient. An unauthenticated request throws 401.

Related: \`GET /notifications/count\` for the unread/approval badge counts; \`POST /notifications/read-all\` and \`POST /notifications/:id/read\` to mark read; \`GET /hub/inbox\` for the same data inside the Hub cockpit.`,
    }),
    zQuery(NotificationListQuery),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { unreadOnly, organizationId, type } = c.req.valid('query');
      const rows = await db
        .select()
        .from(notification)
        .where(inboxWhere(session.user.id, { unreadOnly, organizationId, type }))
        .orderBy(desc(notification.createdAt));
      return ok(c, pageOf(NotificationOut), { items: rows.map(toOut) });
    },
  )
  .get(
    '/count',
    apiDoc({
      tag: 'Notifications',
      summary: 'Get notification counts',
      response: NotificationCount,
      description: `Return the caller's cross-org **unread attention counts** — the numbers that drive the rail badges. \`unread\` is the total of every unread notification across all of the caller's orgs; \`pendingApprovals\` is the subset of those whose type is \`approval_request\` (the actionable approval queue surfaced in the Inbox). Implemented as a single scan of the caller's unread set, partitioned by type in memory rather than issuing two COUNT queries (the inbox is small and already user-scoped).

No capability required; session-only. 401 when unauthenticated. Side-effect-free read. Related: \`GET /notifications\` for the full list; marking notifications read via the read/read-all endpoints decrements these counts.`,
    }),
    async (c) => {
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
    },
  )
  .post(
    '/read-all',
    apiDoc({
      tag: 'Notifications',
      summary: 'Mark notifications read',
      response: NotificationReadAllResult,
      description: `Bulk-mark the caller's notifications read by stamping \`readAt = now\`. **Side effect:** flips unread rows to read, which decrements the badge counts from \`GET /notifications/count\`. With an empty body the caller's entire inbox is marked read; the optional \`organizationId\` and \`type\` filters (AND-combined) scope the action to one org and/or one notification kind.

Only rows that are still unread (\`readAt IS NULL\`) are updated, so the returned \`updated\` count reflects the **real transition count** and the operation is idempotent — re-running it reports 0 on the second call. Scoped to the caller by the mandatory \`userId\` predicate; session-only, no capability. 401 when unauthenticated. Related: \`POST /notifications/:id/read\` for a single notification.`,
    }),
    zJson(NotificationReadAll),
    async (c) => {
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
    },
  )
  .post(
    '/:id/read',
    apiDoc({
      tag: 'Notifications',
      summary: 'Mark a notification read',
      response: NotificationOut,
      description: `Mark a single notification read by id and return its updated representation. **Side effect:** stamps \`readAt = now\` on the row, decrementing the unread/approval counts. The update is constrained to \`(id, userId = session.user.id)\`, so a caller can only ever mark their own notifications — a notification belonging to another user (or a non-existent id) yields **404 Not Found** (existence-hiding), never a cross-user write.

Session-only, no capability; 401 when unauthenticated. Related: \`POST /notifications/read-all\` for the bulk variant; \`POST /notifications/:id/act\` to handle an actionable notification inline.`,
    }),
    zParam(idParam),
    async (c) => {
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
    },
  )
  .post(
    '/:id/act',
    apiDoc({
      tag: 'Notifications',
      summary: 'Act on a notification',
      response: NotificationOut,
      description: `Take a low-risk inline action on a notification directly from the Inbox (e.g. acknowledge or approve) and return its updated representation. The request body's \`action\` string names the inline action the client invoked. **Side effect / persisted model:** acting *handles* the item, which in the persisted model means marking it read — the schema carries no separate \`actedAt\` column, so the resulting state is simply the read notification (\`readAt = now\`). The action name is not stored; it conveys client intent for the transition only.

The update is constrained to \`(id, userId = session.user.id)\`; a notification the caller doesn't own (or a missing id) returns **404**. Session-only, no capability; 401 when unauthenticated. Related: \`POST /notifications/:id/read\` (plain read, no action semantics).`,
    }),
    zParam(idParam),
    zJson(NotificationAct),
    async (c) => {
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
    },
  );

export default notifications;
