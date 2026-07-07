import type { Database } from '@docket/db';
import { notificationInboundEvent, notificationIntent, operatorAuditEvent } from '@docket/db';
import { NotificationInboundEventOut, NotificationIntentOut } from '@docket/notifications';
import { AdminAuditPage } from '../admin-dto';
import type { AppEnv } from '../context';
import { ConflictError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zParam, zQuery } from '../lib/validate';
import { pageOf } from '@docket/types';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { NotificationIntentService } from '../services/notifications/intent-service';
import { toNotificationIntentOut } from '../services/notifications/intents';

import { audit, toAuditOut } from './admin-serializers';

const idParam = z.object({ id: z.string() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Build staff notification monitoring and approval routes. */
export function createAdminNotificationRoutes(
  intents: NotificationIntentService,
  database: Database,
) {
  return new Hono<AppEnv>()
    .get(
      '/',
      apiDoc({
        tag: 'Admin Notifications',
        summary: 'List notification intents',
        response: pageOf(NotificationIntentOut),
        description: 'List notification intents for the staff announcement/monitoring surface.',
      }),
      zQuery(listQuery),
      async (c) => {
        const { limit, offset } = c.req.valid('query');
        const rows = await database
          .select()
          .from(notificationIntent)
          .orderBy(desc(notificationIntent.createdAt))
          .limit(limit)
          .offset(offset);
        return ok(c, pageOf(NotificationIntentOut), {
          items: rows.map(toNotificationIntentOut),
        });
      },
    )
    .get(
      '/:id',
      apiDoc({
        tag: 'Admin Notifications',
        summary: 'Get a notification intent',
        response: NotificationIntentOut,
        description: 'Return one notification intent for the staff monitoring surface.',
      }),
      zParam(idParam),
      async (c) => {
        const { userId } = c.get('staffCtx');
        return ok(c, NotificationIntentOut, await intents.get(userId, c.req.valid('param').id));
      },
    )
    .post(
      '/:id/approve',
      apiDoc({
        tag: 'Admin Notifications',
        summary: 'Approve a notification intent',
        response: NotificationIntentOut,
        description:
          'Approve a draft or scheduled notification by moving it into the queued state and recording operator audit.',
      }),
      zParam(idParam),
      async (c) => {
        const { staffUserId } = c.get('staffCtx');
        const id = c.req.valid('param').id;
        const [existing] = await database
          .select()
          .from(notificationIntent)
          .where(eq(notificationIntent.id, id))
          .limit(1);
        if (!existing) throw new NotFoundError('Notification intent not found');
        if (!['draft', 'scheduled'].includes(existing.status)) {
          throw new ConflictError('Notification intent cannot be approved from its current state');
        }
        const [updated] = await database
          .update(notificationIntent)
          .set({ status: 'queued', updatedAt: new Date() })
          .where(eq(notificationIntent.id, id))
          .returning();
        if (!updated) throw new NotFoundError('Notification intent not found');
        await audit(database, staffUserId, 'notification.approved', 'notification', id, {
          previousStatus: existing.status,
          status: updated.status,
        });
        return ok(c, NotificationIntentOut, toNotificationIntentOut(updated));
      },
    )
    .post(
      '/:id/reject',
      apiDoc({
        tag: 'Admin Notifications',
        summary: 'Reject a notification intent',
        response: NotificationIntentOut,
        description:
          'Reject a not-yet-delivered notification by canceling it and recording operator audit.',
      }),
      zParam(idParam),
      async (c) => {
        const { staffUserId, userId } = c.get('staffCtx');
        const id = c.req.valid('param').id;
        const rejected = await intents.cancel(userId, id);
        await audit(database, staffUserId, 'notification.rejected', 'notification', id, {
          status: rejected.status,
        });
        return ok(c, NotificationIntentOut, rejected);
      },
    )
    .get(
      '/:id/audit',
      apiDoc({
        tag: 'Admin Notifications',
        summary: 'List notification audit events',
        response: AdminAuditPage,
        description: 'List operator audit entries for one notification intent.',
      }),
      zParam(idParam),
      async (c) => {
        await intents.get(c.get('staffCtx').userId, c.req.valid('param').id);
        const rows = await database
          .select()
          .from(operatorAuditEvent)
          .where(
            and(
              eq(operatorAuditEvent.subjectType, 'notification'),
              eq(operatorAuditEvent.subjectId, c.req.valid('param').id),
            ),
          )
          .orderBy(desc(operatorAuditEvent.createdAt));
        return ok(c, AdminAuditPage, { items: rows.map(toAuditOut) });
      },
    )
    .get(
      '/:id/inbound-events',
      apiDoc({
        tag: 'Admin Notifications',
        summary: 'List notification inbound events',
        response: pageOf(NotificationInboundEventOut),
        description: 'List normalized provider callbacks and replies attached to one intent.',
      }),
      zParam(idParam),
      async (c) => {
        await intents.get(c.get('staffCtx').userId, c.req.valid('param').id);
        const rows = await database
          .select()
          .from(notificationInboundEvent)
          .where(eq(notificationInboundEvent.notificationId, c.req.valid('param').id))
          .orderBy(desc(notificationInboundEvent.receivedAt));
        return ok(c, pageOf(NotificationInboundEventOut), {
          items: rows.map((row) => ({
            id: row.id,
            notificationId: row.notificationId,
            deliveryId: row.deliveryId,
            channel: row.channel,
            kind: row.kind,
            from: row.from,
            payload: row.payload,
            receivedAt: row.receivedAt.toISOString(),
          })),
        });
      },
    );
}
