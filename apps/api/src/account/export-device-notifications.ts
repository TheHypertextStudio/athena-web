/**
 * `@docket/api` — the synced-phone-notification section of the personal-data export.
 *
 * @remarks
 * Notifications a person's phone synced are personal data they gave Docket, so the export carries
 * all of it: each registered device, each notification with the messages stored with it and its
 * removal, and the deletion times they recorded. Wired into `collectAccountExport` as
 * `personal.deviceNotifications`.
 */
import {
  deviceNotification,
  deviceNotificationDeletion,
  deviceNotificationMessage,
  deviceNotificationRemoval,
  deviceNotificationSource,
  type Database,
} from '@docket/db';
import { asc, eq } from 'drizzle-orm';

type NotificationRow = typeof deviceNotification.$inferSelect;
type MessageRow = typeof deviceNotificationMessage.$inferSelect;
type RemovalRow = typeof deviceNotificationRemoval.$inferSelect;

/** The exported section. */
export interface DeviceNotificationExport {
  readonly sources: (typeof deviceNotificationSource.$inferSelect)[];
  readonly notifications: (NotificationRow & {
    readonly messages: MessageRow[];
    readonly removal: RemovalRow | null;
  })[];
  readonly deletions: (typeof deviceNotificationDeletion.$inferSelect)[];
}

/** An empty section, for an account with no hub. */
export const EMPTY_DEVICE_NOTIFICATION_EXPORT: DeviceNotificationExport = {
  sources: [],
  notifications: [],
  deletions: [],
};

/**
 * Collect every synced notification row a hub owns.
 *
 * @param db - The database client.
 * @param hubId - The account's hub, or undefined when it has none.
 */
export async function collectDeviceNotificationExport(
  db: Database,
  hubId: string | undefined,
): Promise<DeviceNotificationExport> {
  if (!hubId) return EMPTY_DEVICE_NOTIFICATION_EXPORT;
  const [sources, notifications, messages, removals, deletions] = await Promise.all([
    db
      .select()
      .from(deviceNotificationSource)
      .where(eq(deviceNotificationSource.hubId, hubId))
      .orderBy(asc(deviceNotificationSource.createdAt)),
    db
      .select()
      .from(deviceNotification)
      .where(eq(deviceNotification.hubId, hubId))
      .orderBy(asc(deviceNotification.capturedAt), asc(deviceNotification.id)),
    db
      .select()
      .from(deviceNotificationMessage)
      .where(eq(deviceNotificationMessage.hubId, hubId))
      .orderBy(asc(deviceNotificationMessage.sentAt), asc(deviceNotificationMessage.id)),
    db.select().from(deviceNotificationRemoval).where(eq(deviceNotificationRemoval.hubId, hubId)),
    db.select().from(deviceNotificationDeletion).where(eq(deviceNotificationDeletion.hubId, hubId)),
  ]);
  const messagesByNotification = new Map<string, MessageRow[]>();
  for (const message of messages) {
    const list = messagesByNotification.get(message.notificationId) ?? [];
    list.push(message);
    messagesByNotification.set(message.notificationId, list);
  }
  const removalByNotification = new Map(removals.map((row) => [row.notificationId, row]));
  return {
    sources,
    notifications: notifications.map((row) => ({
      ...row,
      messages: messagesByNotification.get(row.id) ?? [],
      removal: removalByNotification.get(row.id) ?? null,
    })),
    deletions,
  };
}
