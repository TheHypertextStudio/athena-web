import {
  NotificationDeliveryOut,
  NotificationIntentCreate,
  NotificationIntentOut,
  NotificationRecipientOut,
} from '@docket/notifications';
import { pageOf } from '@docket/types';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import {
  NotificationDispatchResultOut,
  type NotificationIntentUseCases,
} from '../services/notifications/intent-use-cases';

const idParam = z.object({ id: z.string() });

/** Dependencies consumed by the staff notification intent route factory. */
export interface NotificationIntentRouteDependencies {
  /** Staff notification intent use cases. */
  readonly intents: NotificationIntentUseCases;
}

/** Build staff-owned routes for service-wide notification intents. */
export function createNotificationIntentRoutes(deps: NotificationIntentRouteDependencies) {
  return new Hono<AppEnv>()
    .post(
      '/',
      apiDoc({
        tag: 'Notification Intents',
        summary: 'Create a notification intent',
        response: NotificationIntentOut,
        description:
          'Create a staff-owned draft or scheduled notification intent. Sending is explicit via the send endpoint.',
      }),
      zJson(NotificationIntentCreate),
      async (c) => {
        return ok(
          c,
          NotificationIntentOut,
          await deps.intents.create(requireUserId(c), c.req.valid('json')),
        );
      },
    )
    .get(
      '/:id/recipients',
      apiDoc({
        tag: 'Notification Intents',
        summary: 'List notification recipients',
        response: pageOf(NotificationRecipientOut),
        description: 'List the immutable recipient snapshot for a notification intent.',
      }),
      zParam(idParam),
      async (c) => {
        return ok(
          c,
          pageOf(NotificationRecipientOut),
          await deps.intents.listRecipients(requireUserId(c), c.req.valid('param').id),
        );
      },
    )
    .get(
      '/:id/deliveries',
      apiDoc({
        tag: 'Notification Intents',
        summary: 'List notification deliveries',
        response: pageOf(NotificationDeliveryOut),
        description: 'List per-channel delivery attempts for a notification intent.',
      }),
      zParam(idParam),
      async (c) => {
        return ok(
          c,
          pageOf(NotificationDeliveryOut),
          await deps.intents.listDeliveries(requireUserId(c), c.req.valid('param').id),
        );
      },
    )
    .post(
      '/:id/send',
      apiDoc({
        tag: 'Notification Intents',
        summary: 'Send a notification intent',
        response: NotificationIntentOut,
        description: 'Snapshot recipients and attempt delivery for a draft or scheduled intent.',
      }),
      zParam(idParam),
      async (c) => {
        return ok(
          c,
          NotificationIntentOut,
          await deps.intents.send(requireUserId(c), c.req.valid('param').id),
        );
      },
    )
    .post(
      '/:id/cancel',
      apiDoc({
        tag: 'Notification Intents',
        summary: 'Cancel a notification intent',
        response: NotificationIntentOut,
        description: 'Cancel a draft, queued, or scheduled notification intent before delivery.',
      }),
      zParam(idParam),
      async (c) => {
        return ok(
          c,
          NotificationIntentOut,
          await deps.intents.cancel(requireUserId(c), c.req.valid('param').id),
        );
      },
    )
    .post(
      '/:id/test',
      apiDoc({
        tag: 'Notification Intents',
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
          await deps.intents.testSend(requireUserId(c), c.req.valid('param').id),
        );
      },
    )
    .get(
      '/:id',
      apiDoc({
        tag: 'Notification Intents',
        summary: 'Get a notification intent',
        response: NotificationIntentOut,
        description: 'Return one staff-visible notification intent.',
      }),
      zParam(idParam),
      async (c) => {
        return ok(
          c,
          NotificationIntentOut,
          await deps.intents.get(requireUserId(c), c.req.valid('param').id),
        );
      },
    );
}

function requireUserId(c: Context<AppEnv>): string {
  const session = c.get('session');
  if (!session?.user) throw new AuthError();
  return session.user.id;
}
