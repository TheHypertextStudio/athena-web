import type { Database, notificationDelivery } from '@docket/db';
import { PushSendError, type PushSender } from '@docket/integrations';
import type { NotificationContent } from '@docket/notifications';

import {
  activeDeliveryContactPoint,
  disableContactPoint,
  markDeliveryFailed,
  markDeliverySent,
  requireNotificationDelivery,
} from './delivery';

type NotificationDeliveryRow = typeof notificationDelivery.$inferSelect;

/** Input for attempting one push-channel notification delivery. */
export interface DeliverPushNotificationInput {
  /** Durable notification intent id. */
  readonly notificationId: string;
  /** Delivery row to mark sent/failed. */
  readonly deliveryId: string;
  /** Subject line from the notification intent. */
  readonly subject: string;
  /** Intent body rendered into push title/body. */
  readonly body: NotificationContent;
  /** Timestamp recorded on success. */
  readonly now: Date;
  /** Optional injected push sender for focused adapter tests. */
  readonly push?: PushSender;
}

/** Sends one push delivery through the push sender port and records the delivery result. */
export async function deliverPushNotification(
  db: Database,
  input: DeliverPushNotificationInput,
): Promise<NotificationDeliveryRow> {
  const push = input.push ?? (await getDefaultPushSender());
  const delivery = await requireNotificationDelivery(db, input.deliveryId, 'Push');
  const point = await activeDeliveryContactPoint(db, delivery, 'push_token');
  if (!point) {
    return markPushFailed(db, input.deliveryId, 'push_contact_point_not_found');
  }

  try {
    const sent = await push.send({
      token: point.value,
      title: input.subject,
      ...(input.body.text ? { body: input.body.text } : {}),
      data: { notificationId: input.notificationId, deliveryId: input.deliveryId },
    });
    return await markDeliverySent(db, input.deliveryId, {
      sentAt: input.now,
      providerMessageId: sent.id,
      providerPayload: { sentAt: sent.sentAt },
    });
  } catch (error) {
    if (error instanceof PushSendError && error.code === 'invalid_token') {
      await disableContactPoint(db, point.id, input.now);
      return await markPushFailed(db, input.deliveryId, 'push_invalid_token');
    }
    return await markPushFailed(db, input.deliveryId, 'push_send_failed');
  }
}

async function getDefaultPushSender(): Promise<PushSender> {
  const { getContainer } = await import('../../../container');
  return getContainer().push;
}

async function markPushFailed(
  db: Database,
  deliveryId: string,
  errorCode: string,
): Promise<NotificationDeliveryRow> {
  return markDeliveryFailed(db, deliveryId, {
    errorCode,
    errorMessage: 'Push delivery failed',
  });
}
