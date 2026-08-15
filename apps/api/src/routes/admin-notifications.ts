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
import { zJson, zParam, zQuery } from '../lib/validate';
import { pageOf } from '@docket/types';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AdminNotificationService } from '../services/notifications/admin-service';

const idParam = z.object({ id: z.string() });
/**
 * An operator's review decision on a notification intent.
 *
 * @remarks
 * Local to this staff surface rather than shared through `@docket/types`: the public product
 * API never exposes intent review, so a shared schema would advertise a decision no product
 * client can make.
 */
const NotificationDecision = z
  .object({
    decision: z.enum(['approved', 'rejected']).describe('What the reviewing operator decided.'),
  })
  .meta({
    id: 'AdminNotificationDecision',
    description: 'A staff review decision on a notification intent.',
  });
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
    .put(
      '/:id/decision',
      apiDoc({
        tag: 'Admin Notifications',
        summary: 'Decide a notification intent',
        response: NotificationIntentOut,
        description:
          'Record the operator’s review decision on a not-yet-delivered notification and return the updated intent. `decision: "approved"` moves a draft or scheduled intent into the queued state; `decision: "rejected"` cancels it. Either way an operator audit event is written, because the decision — including the decision not to send — is the record of what staff did. One address for one decision: an intent holds exactly one, and re-sending the same value names the same end state.',
      }),
      zParam(idParam),
      zJson(NotificationDecision),
      async (c) => {
        const { staffUserId, userId } = c.get('staffCtx');
        const { id } = c.req.valid('param');
        const { decision } = c.req.valid('json');
        return ok(
          c,
          NotificationIntentOut,
          decision === 'approved'
            ? await notifications.approve(staffUserId, id)
            : await notifications.reject(userId, staffUserId, id),
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
