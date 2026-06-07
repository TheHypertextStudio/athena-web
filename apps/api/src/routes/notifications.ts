/**
 * `@docket/api` — notifications router (TOP-LEVEL, mounted at `/v1/notifications`).
 *
 * @remarks
 * This is a cross-org surface: it reads `c.get('session')` directly (NOT `actorCtx`)
 * because the caller's inbox spans every org they belong to. The notification's
 * `userId` is the recipient (the session user id), so rows are filtered by user, not
 * by org. A null session throws {@link AuthError}. Marking-read is the only mutation.
 */
import { db, notification } from '@docket/db';
import { NotificationOut, pageOf } from '@docket/types';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { zParam } from '../lib/validate';

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

/** Notifications router: the caller's cross-org Hub inbox + mark-as-read. */
const notifications = new Hono<AppEnv>()
  .get('/', async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const rows = await db
      .select()
      .from(notification)
      .where(eq(notification.userId, session.user.id))
      .orderBy(desc(notification.createdAt));
    return ok(c, pageOf(NotificationOut), { items: rows.map(toOut) });
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
  });

export default notifications;
