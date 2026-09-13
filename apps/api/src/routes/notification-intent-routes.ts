import {
  NotificationDeliveryOut,
  NotificationIntentCreate,
  NotificationIntentOut,
  NotificationRecipientOut,
} from '@docket/notifications/schemas';
import { pageOf } from '../contracts/pagination';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import {
  NotificationDispatchResultOut,
  type NotificationIntentService,
} from '../services/notifications/intent-service';

const idParam = z.object({ id: z.string() });

/** Build intent management routes mounted only behind the admin staff middleware. */
export function createNotificationIntentRoutes(intents: NotificationIntentService) {
  return new Hono<AppEnv>()
    .post(
      '/',
      apiDoc({
        status: 201,
        tag: 'Admin Notifications',
        summary: 'Create a notification intent',
        response: NotificationIntentOut,
        description:
          'Create a staff-owned draft or scheduled notification intent. Sending is explicit via the send endpoint.',
      }),
      zJson(NotificationIntentCreate),
      async (c) => {
        return created(
          c,
          NotificationIntentOut,
          await intents.create(c.get('staffCtx').userId, c.req.valid('json')),
        );
      },
    )
    .get(
      '/:id/recipients',
      apiDoc({
        tag: 'Admin Notifications',
        summary: 'List notification recipients',
        response: pageOf(NotificationRecipientOut),
        description: 'List the immutable recipient snapshot for a notification intent.',
      }),
      zParam(idParam),
      async (c) => {
        return ok(
          c,
          pageOf(NotificationRecipientOut),
          await intents.listRecipients(c.get('staffCtx').userId, c.req.valid('param').id),
        );
      },
    )
    .get(
      '/:id/deliveries',
      apiDoc({
        tag: 'Admin Notifications',
        summary: 'List notification deliveries',
        response: pageOf(NotificationDeliveryOut),
        description: 'List per-channel delivery attempts for a notification intent.',
      }),
      zParam(idParam),
      async (c) => {
        return ok(
          c,
          pageOf(NotificationDeliveryOut),
          await intents.listDeliveries(c.get('staffCtx').userId, c.req.valid('param').id),
        );
      },
    )
    .post(
      '/:id/send',
      apiDoc({
        tag: 'Admin Notifications',
        summary: 'Send a notification intent',
        response: NotificationIntentOut,
        description: 'Snapshot recipients and attempt delivery for a draft or scheduled intent.',
      }),
      zParam(idParam),
      async (c) => {
        return ok(
          c,
          NotificationIntentOut,
          await intents.send(c.get('staffCtx').userId, c.req.valid('param').id),
        );
      },
    )
    .post(
      '/:id/cancel',
      apiDoc({
        tag: 'Admin Notifications',
        summary: 'Cancel a notification intent',
        response: NotificationIntentOut,
        description: 'Cancel a draft, queued, or scheduled notification intent before delivery.',
      }),
      zParam(idParam),
      async (c) => {
        return ok(
          c,
          NotificationIntentOut,
          await intents.cancel(c.get('staffCtx').userId, c.req.valid('param').id),
        );
      },
    )
    .post(
      '/:id/test',
      apiDoc({
        tag: 'Admin Notifications',
        summary: 'Test-send a notification intent',
        response: NotificationDispatchResultOut,
        description:
          'Send a copy of an existing intent to the calling staff user without changing the original intent lifecycle.',
      }),
      zParam(idParam),
      async (c) => {
        return ok(
          c,
          NotificationDispatchResultOut,
          await intents.testSend(c.get('staffCtx').userId, c.req.valid('param').id),
        );
      },
    )
    .get(
      '/:id',
      apiDoc({
        tag: 'Admin Notifications',
        summary: 'Get a notification intent',
        response: NotificationIntentOut,
        description: 'Return one staff-visible notification intent.',
      }),
      zParam(idParam),
      async (c) => {
        return ok(
          c,
          NotificationIntentOut,
          await intents.get(c.get('staffCtx').userId, c.req.valid('param').id),
        );
      },
    );
}
