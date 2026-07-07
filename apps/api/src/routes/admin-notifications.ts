import {
  NotificationAudienceEstimateOut,
  NotificationInboundEventOut,
  NotificationIntentOut,
  NotificationPreviewOut,
} from '@docket/notifications';
import { AdminAuditPage } from '../admin-dto';
import type { AppEnv } from '../context';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zParam, zQuery } from '../lib/validate';
import { pageOf } from '@docket/types';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AdminNotificationService } from '../services/notifications/admin-service';

const idParam = z.object({ id: z.string() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Build staff notification monitoring and approval routes. */
export function createAdminNotificationRoutes(notifications: AdminNotificationService) {
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
        return ok(c, pageOf(NotificationIntentOut), await notifications.list(limit, offset));
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
        return ok(
          c,
          NotificationIntentOut,
          await notifications.get(userId, c.req.valid('param').id),
        );
      },
    )
    .get(
      '/:id/estimate',
      apiDoc({
        tag: 'Admin Notifications',
        summary: 'Estimate notification audience',
        response: NotificationAudienceEstimateOut,
        description:
          'Estimate recipient count, channel delivery eligibility, suppressions, and approval gates before staff sends a notification.',
      }),
      zParam(idParam),
      async (c) => {
        return ok(
          c,
          NotificationAudienceEstimateOut,
          await notifications.estimate(c.get('staffCtx').userId, c.req.valid('param').id),
        );
      },
    )
    .get(
      '/:id/preview',
      apiDoc({
        tag: 'Admin Notifications',
        summary: 'Preview notification channels',
        response: NotificationPreviewOut,
        description: 'Render staff-facing previews for each requested notification channel.',
      }),
      zParam(idParam),
      async (c) => {
        return ok(
          c,
          NotificationPreviewOut,
          await notifications.preview(c.get('staffCtx').userId, c.req.valid('param').id),
        );
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
        return ok(
          c,
          NotificationIntentOut,
          await notifications.approve(staffUserId, c.req.valid('param').id),
        );
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
        return ok(
          c,
          NotificationIntentOut,
          await notifications.reject(userId, staffUserId, c.req.valid('param').id),
        );
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
        return ok(
          c,
          AdminAuditPage,
          await notifications.listAudit(c.get('staffCtx').userId, c.req.valid('param').id),
        );
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
        return ok(
          c,
          pageOf(NotificationInboundEventOut),
          await notifications.listInboundEvents(c.get('staffCtx').userId, c.req.valid('param').id),
        );
      },
    );
}
