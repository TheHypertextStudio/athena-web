/** Explicit consent for personal notification triage, independent of sync consent. */
import {
  db,
  agentSession,
  notificationTriageSettings,
  notificationTriageEvent,
  type Database,
} from '@docket/db';
import type { NotificationTriageSettingsOut } from '@docket/athena/inbound-contract';
import { eq, isNull, and } from 'drizzle-orm';

/** Read the caller's opt-in without creating or enabling anything. */
export async function readNotificationTriageSettings(
  hubId: string,
  database: Database = db,
): Promise<NotificationTriageSettingsOut> {
  const [row] = await database
    .select()
    .from(notificationTriageSettings)
    .where(eq(notificationTriageSettings.hubId, hubId));
  return { enabled: row?.enabled ?? false, enabledAt: row?.enabledAt?.getTime() ?? null };
}

/** Lock consent against concurrent capture/dispatch; an off/on cycle starts a fresh window. */
export async function setNotificationTriageSettings(
  hubId: string,
  enabled: boolean,
  now = new Date(),
  database: Database = db,
): Promise<NotificationTriageSettingsOut> {
  return database.transaction(async (tx) => {
    await tx.insert(notificationTriageSettings).values({ hubId }).onConflictDoNothing();
    const [prior] = await tx
      .select()
      .from(notificationTriageSettings)
      .where(eq(notificationTriageSettings.hubId, hubId))
      .for('update');
    const enabledAt = enabled ? (prior?.enabled ? prior.enabledAt : now) : null;
    await tx
      .update(notificationTriageSettings)
      .set({ enabled, enabledAt })
      .where(eq(notificationTriageSettings.hubId, hubId));
    if (!enabled && prior?.activeSessionId) {
      await tx
        .update(agentSession)
        .set({ status: 'canceled', endedAt: now })
        .where(
          and(
            eq(agentSession.id, prior.activeSessionId),
            eq(agentSession.status, 'pending'),
            isNull(agentSession.startedAt),
          ),
        );
    }
    if (!enabled)
      await tx
        .delete(notificationTriageEvent)
        .where(
          and(eq(notificationTriageEvent.hubId, hubId), isNull(notificationTriageEvent.sessionId)),
        );
    return { enabled, enabledAt: enabledAt?.getTime() ?? null };
  });
}
