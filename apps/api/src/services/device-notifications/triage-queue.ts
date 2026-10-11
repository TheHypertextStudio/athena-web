/** Add eligible freshly inserted captures to the triage outbox in their storage transaction. */
import {
  notificationTriageEvent,
  notificationTriageSettings,
  deviceNotification,
  type Database,
} from '@docket/db';
import { and, eq, gt, inArray } from 'drizzle-orm';

/** Store references only, after locking the same consent row used by settings and dispatch. */
export async function enqueueNotificationTriage(
  database: Database,
  hubId: string,
  ids: readonly string[],
  now: Date,
): Promise<void> {
  if (ids.length === 0) return;
  await database.insert(notificationTriageSettings).values({ hubId }).onConflictDoNothing();
  const [settings] = await database
    .select()
    .from(notificationTriageSettings)
    .where(eq(notificationTriageSettings.hubId, hubId))
    .for('update');
  if (!settings?.enabled || !settings.enabledAt) return;
  const eligible = await database
    .select({ id: deviceNotification.id })
    .from(deviceNotification)
    .where(
      and(
        eq(deviceNotification.hubId, hubId),
        inArray(deviceNotification.id, [...ids]),
        gt(deviceNotification.capturedAt, settings.enabledAt),
        gt(deviceNotification.expiresAt, now),
        eq(deviceNotification.backfilled, false),
        eq(deviceNotification.redacted, false),
      ),
    );
  if (eligible.length > 0)
    await database
      .insert(notificationTriageEvent)
      .values(eligible.map((row) => ({ hubId, notificationId: row.id, createdAt: now })))
      .onConflictDoNothing();
}
