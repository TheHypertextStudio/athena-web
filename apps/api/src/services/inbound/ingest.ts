/** Schema-directed personal ingress; notification writes share the legacy transaction. */
import type { Database } from '@docket/db';
import { db, hub, personalInboundReceipt } from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';
import {
  PlatformNotificationCaptured,
  PlatformNotificationRemoved,
  type PersonalInboundBatchIn,
  type PersonalInboundBatchOut,
} from '@docket/athena/inbound-contract';
import type {
  DeviceNotificationBatchIn,
  DeviceNotificationBatchOut,
} from '@docket/athena/device-notification-contract';
import { ingestBatch } from '../device-notifications/ingest';

type StagedNotification =
  | { kind: 'notifications'; payload: DeviceNotificationBatchIn['notifications'][number] }
  | { kind: 'removals'; payload: DeviceNotificationBatchIn['removals'][number] };

/** Schema-dispatched handlers validate and stage one family for its transactional storage service. */
const handlers = new Map<string, (event: unknown) => StagedNotification | null>([
  [
    'platform.notification.captured',
    (event) => {
      const result = PlatformNotificationCaptured.safeParse(event);
      return result.success ? { kind: 'notifications', payload: result.data.payload } : null;
    },
  ],
  [
    'platform.notification.removed',
    (event) => {
      const result = PlatformNotificationRemoved.safeParse(event);
      return result.success ? { kind: 'removals', payload: result.data.payload } : null;
    },
  ],
]);

/** Validate siblings independently and durably settle notifications before their removals. */
export async function ingestPersonalInbound(
  hubId: string,
  batch: PersonalInboundBatchIn,
  now = new Date(),
  database: Database = db,
): Promise<PersonalInboundBatchOut> {
  return database.transaction(async (tx) => {
    // Serialize event identities across sources; payload writes and receipts commit together.
    await tx.select({ id: hub.id }).from(hub).where(eq(hub.id, hubId)).for('update');
    const notifications: DeviceNotificationBatchIn['notifications'] = [];
    const removals: DeviceNotificationBatchIn['removals'] = [];
    const positions: { index: number; kind: 'notifications' | 'removals'; offset: number }[] = [];
    const events: PersonalInboundBatchOut['events'] = batch.events.map((event) => ({
      id: event.id,
      status: 'invalid',
    }));
    const prior = await tx
      .select({ id: personalInboundReceipt.eventId })
      .from(personalInboundReceipt)
      .where(
        and(
          eq(personalInboundReceipt.hubId, hubId),
          inArray(
            personalInboundReceipt.eventId,
            batch.events.map((event) => event.id),
          ),
        ),
      );
    const seen = new Set(prior.map((row) => row.id));
    const accepted: { hubId: string; eventId: string; type: string; receivedAt: Date }[] = [];
    for (const [index, event] of batch.events.entries()) {
      const type = typeof event.type === 'string' ? event.type : '';
      const staged = handlers.get(type)?.(event);
      if (!staged) continue;
      if (seen.has(event.id)) {
        events[index] = { id: event.id, status: 'duplicate' };
        continue;
      }
      seen.add(event.id);
      accepted.push({
        hubId,
        eventId: event.id,
        type,
        receivedAt: now,
      });
      if (staged.kind === 'notifications') {
        positions.push({ index, kind: 'notifications', offset: notifications.length });
        notifications.push(staged.payload);
      } else {
        positions.push({ index, kind: 'removals', offset: removals.length });
        removals.push(staged.payload);
      }
    }
    const results = await ingestBatch(
      hubId,
      { deviceId: batch.sourceId, notifications, removals },
      now,
      tx,
    );
    for (const position of positions) {
      const result = results[position.kind][position.offset];
      if (!result) throw new Error('Inbound handler omitted a receipt');
      events[position.index] = result;
    }
    if (accepted.length > 0) await tx.insert(personalInboundReceipt).values(accepted);
    return { events };
  });
}

/** Compatibility adapter: both ingress routes execute the same notification handlers. */
export async function ingestLegacyNotifications(
  hubId: string,
  batch: DeviceNotificationBatchIn,
  now = new Date(),
): Promise<DeviceNotificationBatchOut> {
  const events = [
    ...batch.notifications.map((payload) => ({
      id: payload.id,
      type: 'platform.notification.captured',
      occurredAt: payload.capturedAt,
      payload,
    })),
    ...batch.removals.map((payload) => ({
      id: payload.id,
      type: 'platform.notification.removed',
      occurredAt: payload.removedAt,
      payload,
    })),
  ];
  const result = await ingestPersonalInbound(
    hubId,
    { schemaVersion: 1, sourceId: batch.deviceId, events },
    now,
  );
  return {
    notifications: result.events.slice(0, batch.notifications.length),
    removals: result.events.slice(batch.notifications.length),
  };
}
