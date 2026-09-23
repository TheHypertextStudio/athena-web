/**
 * `@docket/api` — expiry of synced phone notifications.
 *
 * @remarks
 * Each row carries the `expires_at` its device's retention gave it when it was stored. Two paths
 * delete expired rows, and neither is a new worker: every upload first deletes the uploader's own
 * expired rows ({@link purgeExpiredForHub}), and the existing daily expired-drafts cron tick sweeps
 * everyone's ({@link sweepExpiredDeviceNotifications}), so a person who stops syncing still loses
 * their rows on schedule. Messages and removals go with their notification through the cascade.
 * Reads already leave expired rows out, so both paths only reclaim storage.
 */
import { db, deviceNotification, type Database } from '@docket/db';
import { and, eq, lte } from 'drizzle-orm';

/** The outcome of one sweep tick. */
export interface DeviceNotificationSweepResult {
  /** Expired notifications deleted this tick. */
  readonly deleted: number;
}

/** Delete one person's expired notifications. */
export async function purgeExpiredForHub(
  database: Database,
  hubId: string,
  now: Date,
): Promise<number> {
  const deleted = await database
    .delete(deviceNotification)
    .where(and(eq(deviceNotification.hubId, hubId), lte(deviceNotification.expiresAt, now)))
    .returning({ id: deviceNotification.id });
  return deleted.length;
}

/** Delete every person's expired notifications. A plain stateless delete, safe to retry. */
export async function sweepExpiredDeviceNotifications(
  now: Date,
  database: Database = db,
): Promise<DeviceNotificationSweepResult> {
  const deleted = await database
    .delete(deviceNotification)
    .where(lte(deviceNotification.expiresAt, now))
    .returning({ id: deviceNotification.id });
  return { deleted: deleted.length };
}
