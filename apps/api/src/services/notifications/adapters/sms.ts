import type { Database, notificationDelivery } from '@docket/db';
import type { SmsSender } from '@docket/integrations';
import type { NotificationContent } from '@docket/notifications';

import {
  activeDeliveryContactPoint,
  markDeliveryFailed,
  markDeliverySent,
  requireNotificationDelivery,
} from './delivery';

type NotificationDeliveryRow = typeof notificationDelivery.$inferSelect;

/** Input for attempting one SMS-channel notification delivery. */
export interface DeliverSmsNotificationInput {
  /** Delivery row to mark sent/failed. */
  readonly deliveryId: string;
  /** Subject line from the notification intent. */
  readonly subject: string;
  /** Intent body rendered into SMS text. */
  readonly body: NotificationContent;
  /** Timestamp recorded on success. */
  readonly now: Date;
  /** Optional injected SMS sender for focused adapter tests. */
  readonly sms?: SmsSender;
}

/** Sends one SMS delivery through the SMS sender port and records the delivery result. */
export async function deliverSmsNotification(
  db: Database,
  input: DeliverSmsNotificationInput,
): Promise<NotificationDeliveryRow> {
  const sms = input.sms ?? (await getDefaultSmsSender());
  const delivery = await requireNotificationDelivery(db, input.deliveryId, 'SMS');
  const point = await activeDeliveryContactPoint(db, delivery, 'phone');
  if (!point) {
    return markSmsFailed(db, input.deliveryId, 'sms_contact_point_not_found');
  }

  try {
    const sent = await sms.send({ to: point.value, body: smsBody(input.subject, input.body) });
    return await markDeliverySent(db, input.deliveryId, {
      sentAt: input.now,
      providerMessageId: sent.id,
      providerPayload: { sentAt: sent.sentAt },
    });
  } catch {
    return await markSmsFailed(db, input.deliveryId, 'sms_send_failed');
  }
}

async function getDefaultSmsSender(): Promise<SmsSender> {
  const { getContainer } = await import('../../../container');
  return getContainer().sms;
}

function smsBody(subject: string, body: NotificationContent): string {
  const text = body.text?.trim();
  return text ? `${subject}\n\n${text}` : subject;
}

async function markSmsFailed(
  db: Database,
  deliveryId: string,
  errorCode: string,
): Promise<NotificationDeliveryRow> {
  return markDeliveryFailed(db, deliveryId, {
    errorCode,
    errorMessage: 'SMS delivery failed',
  });
}
