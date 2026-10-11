/** Recoverable personal Athena triage; sessions contain references until execution begins. */
import {
  db,
  agentSession,
  notificationTriageSettings,
  notificationTriageEvent,
  deviceNotification,
  hub,
  genId,
} from '@docket/db';
import { and, asc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { env } from '../../env';
import { admitAthenaGeneration } from '../../agent/async-runner';
import { runSession } from '../../routes/agent-session-runner';

type Session = typeof agentSession.$inferSelect;
const TERMINAL = new Set(['completed', 'failed', 'canceled']);

/** Bind up to 100 unassigned events atomically to one stable owner-attributed session. */
export async function prepareNotificationTriageRun(
  hubId: string,
  now: Date,
): Promise<Session | null> {
  return db.transaction(async (tx) => {
    const [settings] = await tx
      .select()
      .from(notificationTriageSettings)
      .where(eq(notificationTriageSettings.hubId, hubId))
      .for('update');
    if (!settings?.enabled || !settings.enabledAt) return null;
    if (settings.activeSessionId) {
      const [active] = await tx
        .select()
        .from(agentSession)
        .where(eq(agentSession.id, settings.activeSessionId));
      if (active && !TERMINAL.has(active.status)) return active;
    }
    const pending = await tx
      .select({ id: notificationTriageEvent.notificationId })
      .from(notificationTriageEvent)
      .innerJoin(
        deviceNotification,
        and(
          eq(deviceNotification.hubId, notificationTriageEvent.hubId),
          eq(deviceNotification.id, notificationTriageEvent.notificationId),
        ),
      )
      .where(
        and(
          eq(notificationTriageEvent.hubId, hubId),
          isNull(notificationTriageEvent.sessionId),
          gt(deviceNotification.capturedAt, settings.enabledAt),
          gt(deviceNotification.expiresAt, now),
        ),
      )
      .orderBy(asc(notificationTriageEvent.createdAt), asc(notificationTriageEvent.notificationId))
      .limit(100);
    if (pending.length === 0) return null;
    const [owner] = await tx.select({ id: hub.userId }).from(hub).where(eq(hub.id, hubId));
    if (!owner) return null;
    const [session] = await tx
      .insert(agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: owner.id,
        kind: 'job',
        workLinkage: 'observation',
        trigger: 'mention',
        status: 'pending',
        spawnLabel: 'Review new notifications',
        externalRunRef: `notification-triage:${hubId}:${genId()}`,
      })
      .returning();
    if (!session) throw new Error('Notification triage session insert failed');
    await tx
      .update(notificationTriageEvent)
      .set({ sessionId: session.id })
      .where(
        and(
          eq(notificationTriageEvent.hubId, hubId),
          inArray(
            notificationTriageEvent.notificationId,
            pending.map((row) => row.id),
          ),
        ),
      );
    await tx
      .update(notificationTriageSettings)
      .set({ activeSessionId: session.id })
      .where(eq(notificationTriageSettings.hubId, hubId));
    return session;
  });
}

/** Run bounded leased dispatches on the existing minute scheduler; counters contain no content. */
export async function sweepNotificationTriage(
  now = new Date(),
): Promise<{ claimed: number; dispatched: number; failed: number }> {
  const result = { claimed: 0, dispatched: 0, failed: 0 };
  if (env.NOTIFICATION_TRIAGE_DISPATCH !== 'enabled') return result;
  const candidates = await db
    .select({ hubId: notificationTriageSettings.hubId })
    .from(notificationTriageSettings)
    .where(eq(notificationTriageSettings.enabled, true))
    .orderBy(sql`${notificationTriageSettings.leaseUntil} ASC NULLS FIRST`)
    .limit(25);
  for (const candidate of candidates) {
    const token = genId();
    const claimed = await db
      .update(notificationTriageSettings)
      .set({ leaseToken: token, leaseUntil: new Date(now.getTime() + 60_000) })
      .where(
        and(
          eq(notificationTriageSettings.hubId, candidate.hubId),
          or(
            isNull(notificationTriageSettings.leaseUntil),
            lt(notificationTriageSettings.leaseUntil, now),
          ),
        ),
      )
      .returning();
    if (claimed.length === 0) continue;
    result.claimed++;
    try {
      const session = await prepareNotificationTriageRun(candidate.hubId, now);
      if (session && ['pending', 'running'].includes(session.status)) {
        const admission = await admitAthenaGeneration(session, {
          runnableStatuses: ['pending', 'running'],
        });
        if (admission.mode === 'sync') await runSession('', session.id);
        result.dispatched++;
      }
    } catch {
      result.failed++;
    } finally {
      await db
        .update(notificationTriageSettings)
        .set({ leaseToken: null, leaseUntil: now })
        .where(
          and(
            eq(notificationTriageSettings.hubId, candidate.hubId),
            eq(notificationTriageSettings.leaseToken, token),
          ),
        );
    }
  }
  return result;
}
