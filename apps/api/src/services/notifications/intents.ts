import type {
  Database,
  notificationDelivery,
  notificationIntent,
  notificationRecipient,
} from '@docket/db';
import {
  notificationDelivery as deliveryTable,
  notificationIntent as intentTable,
  notificationRecipient as recipientTable,
} from '@docket/db';
import { NotificationAudience } from '@docket/notifications';
import type {
  NotificationDeliveryOut,
  NotificationIntentOut,
  NotificationRecipientOut,
} from '@docket/notifications';
import type { z } from 'zod';
import { eq } from 'drizzle-orm';

type IntentRow = typeof notificationIntent.$inferSelect;
type RecipientRow = typeof notificationRecipient.$inferSelect;
type DeliveryRow = typeof notificationDelivery.$inferSelect;

/** Serialize a notification intent row into the public DTO shape. */
export function toNotificationIntentOut(row: IntentRow): z.input<typeof NotificationIntentOut> {
  return {
    id: row.id,
    senderType: row.senderType,
    senderId: row.senderId,
    organizationId: row.organizationId,
    category: row.category,
    priority: row.priority,
    audience: NotificationAudience.parse(row.audience),
    channels: row.channels,
    subject: row.subject,
    body: row.body,
    replyPolicy: row.replyPolicy,
    status: row.status,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}

/** Serialize a notification recipient snapshot row into the public DTO shape. */
export function toNotificationRecipientOut(
  row: RecipientRow,
): z.input<typeof NotificationRecipientOut> {
  return {
    id: row.id,
    notificationId: row.notificationId,
    userId: row.userId,
    organizationId: row.organizationId,
    reason: row.reason,
    suppressions: row.suppressions,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Serialize a notification delivery row into the public DTO shape. */
export function toNotificationDeliveryOut(
  row: DeliveryRow,
): z.input<typeof NotificationDeliveryOut> {
  return {
    id: row.id,
    notificationId: row.notificationId,
    recipientId: row.recipientId,
    channel: row.channel,
    destination: { type: row.destinationType, ...row.destination },
    status: row.status,
    providerMessageId: row.providerMessageId,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    sentAt: row.sentAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    readAt: row.readAt?.toISOString() ?? null,
    actedAt: row.actedAt?.toISOString() ?? null,
  };
}

/** Return one notification intent, or null when it does not exist. */
export async function getNotificationIntent(db: Database, id: string): Promise<IntentRow | null> {
  const [row] = await db.select().from(intentTable).where(eq(intentTable.id, id)).limit(1);
  return row ?? null;
}

/** Return recipient snapshots for one notification intent. */
export async function listNotificationRecipients(
  db: Database,
  intentId: string,
): Promise<RecipientRow[]> {
  return db.select().from(recipientTable).where(eq(recipientTable.notificationId, intentId));
}

/** Return delivery attempts for one notification intent. */
export async function listNotificationDeliveries(
  db: Database,
  intentId: string,
): Promise<DeliveryRow[]> {
  return db.select().from(deliveryTable).where(eq(deliveryTable.notificationId, intentId));
}
