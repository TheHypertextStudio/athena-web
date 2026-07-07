import type { Database } from '@docket/db';
import { contactPoint, notificationDelivery } from '@docket/db';
import type { ContactPointType } from '@docket/notifications';
import { eq } from 'drizzle-orm';

type NotificationDeliveryRow = typeof notificationDelivery.$inferSelect;
type ContactPointRow = typeof contactPoint.$inferSelect;

/** Load a notification delivery row by id or fail loudly. */
export async function requireNotificationDelivery(
  db: Database,
  id: string,
  channel: string,
): Promise<NotificationDeliveryRow> {
  const [delivery] = await db
    .select()
    .from(notificationDelivery)
    .where(eq(notificationDelivery.id, id))
    .limit(1);
  if (!delivery) throw new Error(`${channel} notification delivery not found`);
  return delivery;
}

/** Load the active, verified contact point targeted by a delivery destination. */
export async function activeDeliveryContactPoint(
  db: Database,
  delivery: NotificationDeliveryRow,
  type: ContactPointType,
): Promise<ContactPointRow | null> {
  const contactPointId = delivery.destination.contactPointId;
  if (!contactPointId) return null;

  const [point] = await db.select().from(contactPoint).where(eq(contactPoint.id, contactPointId));
  if (point?.type !== type || point.status !== 'active' || !point.verifiedAt) return null;
  return point;
}

/** Mark one delivery as sent through a provider. */
export async function markDeliverySent(
  db: Database,
  deliveryId: string,
  input: {
    readonly providerMessageId?: string | null;
    readonly providerPayload?: Record<string, unknown>;
    readonly sentAt: Date;
  },
): Promise<NotificationDeliveryRow> {
  const [updated] = await db
    .update(notificationDelivery)
    .set({
      status: 'sent',
      sentAt: input.sentAt,
      providerMessageId: input.providerMessageId ?? null,
      providerPayload: input.providerPayload ?? {},
      errorCode: null,
      errorMessage: null,
    })
    .where(eq(notificationDelivery.id, deliveryId))
    .returning();
  if (!updated) throw new Error('Failed to update sent notification delivery');
  return updated;
}

/** Mark one delivery as failed with a stable error code. */
export async function markDeliveryFailed(
  db: Database,
  deliveryId: string,
  input: {
    readonly errorCode: string;
    readonly errorMessage: string;
    readonly providerPayload?: Record<string, unknown>;
  },
): Promise<NotificationDeliveryRow> {
  const [updated] = await db
    .update(notificationDelivery)
    .set({
      status: 'failed',
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      providerPayload: input.providerPayload ?? {},
    })
    .where(eq(notificationDelivery.id, deliveryId))
    .returning();
  if (!updated) throw new Error('Failed to update failed notification delivery');
  return updated;
}

/** Disable a contact point after a provider confirms it is no longer reachable. */
export async function disableContactPoint(db: Database, id: string, now: Date): Promise<void> {
  await db
    .update(contactPoint)
    .set({ status: 'disabled', disabledAt: now, primary: false })
    .where(eq(contactPoint.id, id));
}
