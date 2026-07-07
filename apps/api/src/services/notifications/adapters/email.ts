import type { Database, notificationDelivery } from '@docket/db';
import type { Mailer } from '@docket/mail';
import type { NotificationContent } from '@docket/notifications';

import {
  activeDeliveryContactPoint,
  markDeliveryFailed,
  markDeliverySent,
  requireNotificationDelivery,
} from './delivery';

type NotificationDeliveryRow = typeof notificationDelivery.$inferSelect;

/** Input for attempting one email-channel notification delivery. */
export interface DeliverEmailNotificationInput {
  /** Delivery row to mark sent/failed. */
  readonly deliveryId: string;
  /** Subject line from the notification intent. */
  readonly subject: string;
  /** Intent body rendered into email text/html parts. */
  readonly body: NotificationContent;
  /** Timestamp recorded on success. */
  readonly now: Date;
  /** Optional injected mailer for focused adapter tests. */
  readonly mailer?: Mailer;
}

/** Sends one email delivery through the Mailer port and records the delivery result. */
export async function deliverEmailNotification(
  db: Database,
  input: DeliverEmailNotificationInput,
): Promise<NotificationDeliveryRow> {
  const mailer = input.mailer ?? (await getDefaultMailer());
  const delivery = await requireNotificationDelivery(db, input.deliveryId, 'Email');
  const point = await activeDeliveryContactPoint(db, delivery, 'email');
  if (!point) return markEmailFailed(db, input.deliveryId, 'email_contact_point_not_found');

  try {
    await mailer.send({
      to: point.value,
      subject: input.subject,
      ...(input.body.html ? { html: input.body.html } : {}),
      ...(input.body.text ? { text: input.body.text } : {}),
    });
    return await markDeliverySent(db, input.deliveryId, { sentAt: input.now });
  } catch {
    return await markEmailFailed(db, input.deliveryId, 'email_send_failed');
  }
}

async function getDefaultMailer(): Promise<Mailer> {
  const { getContainer } = await import('../../../container');
  return getContainer().mailer;
}

async function markEmailFailed(
  db: Database,
  deliveryId: string,
  errorCode: string,
): Promise<NotificationDeliveryRow> {
  return markDeliveryFailed(db, deliveryId, {
    errorCode,
    errorMessage: 'Email delivery failed',
  });
}
