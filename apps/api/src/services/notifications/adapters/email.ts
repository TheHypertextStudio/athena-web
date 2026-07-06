import type { Mailer } from '@docket/boundaries';
import type { Database } from '@docket/db';
import { contactPoint, notificationDelivery } from '@docket/db';
import type { NotificationContent } from '@docket/notifications';
import { eq } from 'drizzle-orm';

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
  const delivery = await requireDelivery(db, input.deliveryId);
  const contactPointId = delivery.destination.contactPointId;
  if (!contactPointId) {
    return markFailed(db, input.deliveryId, 'email_missing_contact_point');
  }

  const point = await getEmailContactPoint(db, contactPointId);
  if (!point) return markFailed(db, input.deliveryId, 'email_contact_point_not_found');

  try {
    await mailer.send({
      to: point.value,
      subject: input.subject,
      ...(input.body.html ? { html: input.body.html } : {}),
      ...(input.body.text ? { text: input.body.text } : {}),
    });
    const [updated] = await db
      .update(notificationDelivery)
      .set({
        status: 'sent',
        sentAt: input.now,
        errorCode: null,
        errorMessage: null,
      })
      .where(eq(notificationDelivery.id, input.deliveryId))
      .returning();
    if (!updated) throw new Error('Failed to update email notification delivery');
    return updated;
  } catch {
    return markFailed(db, input.deliveryId, 'email_send_failed');
  }
}

async function getDefaultMailer(): Promise<Mailer> {
  const { getContainer } = await import('../../../container');
  return getContainer().mailer;
}

async function requireDelivery(db: Database, id: string): Promise<NotificationDeliveryRow> {
  const [delivery] = await db
    .select()
    .from(notificationDelivery)
    .where(eq(notificationDelivery.id, id))
    .limit(1);
  if (!delivery) throw new Error('Email notification delivery not found');
  return delivery;
}

async function getEmailContactPoint(db: Database, id: string) {
  const [point] = await db.select().from(contactPoint).where(eq(contactPoint.id, id)).limit(1);
  if (point?.type !== 'email' || point.status !== 'active' || !point.verifiedAt) {
    return null;
  }
  return point;
}

async function markFailed(
  db: Database,
  deliveryId: string,
  errorCode: string,
): Promise<NotificationDeliveryRow> {
  const [updated] = await db
    .update(notificationDelivery)
    .set({
      status: 'failed',
      errorCode,
      errorMessage: 'Email delivery failed',
    })
    .where(eq(notificationDelivery.id, deliveryId))
    .returning();
  if (!updated) throw new Error('Failed to update failed email notification delivery');
  return updated;
}
