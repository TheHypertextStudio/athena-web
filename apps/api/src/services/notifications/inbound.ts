import type { Database } from '@docket/db';
import { contactPoint, notificationDelivery, notificationInboundEvent } from '@docket/db';
import type {
  NotificationChannel,
  NotificationInboundEventKind,
  NotificationInboundEventOut,
} from '@docket/notifications';
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';

type NotificationInboundEventRow = typeof notificationInboundEvent.$inferSelect;
type NotificationDeliveryRow = typeof notificationDelivery.$inferSelect;
type ContactPointStatus = typeof contactPoint.$inferSelect.status;

/** Normalized provider callback or inbound user message ready for durable recording. */
export interface NormalizedNotificationProviderEvent {
  /** Provider-specific event id used for retry idempotency when present. */
  readonly providerEventId?: string;
  /** Channel that produced this callback or reply. */
  readonly channel: NotificationChannel;
  /** Normalized event kind stored in `notification_inbound_event`. */
  readonly kind: NotificationInboundEventKind;
  /** Related notification intent id, when known without a delivery lookup. */
  readonly notificationId?: string | null;
  /** Related delivery id, when correlation succeeded. */
  readonly deliveryId?: string | null;
  /** Sender address/number/user token for inbound replies or STOP events. */
  readonly from?: string | null;
  /** Raw provider payload, plus normalized hints useful for support/debugging. */
  readonly payload: Record<string, unknown>;
  /** Delivery status to apply, when the callback represents a delivery lifecycle transition. */
  readonly deliveryStatus?: NotificationDeliveryRow['status'];
  /** Contact-point status to apply, when the provider marks the destination unhealthy. */
  readonly contactPointStatus?: ContactPointStatus;
  /** Receipt timestamp; defaults to now. */
  readonly receivedAt?: Date;
}

/** Record and apply one normalized notification provider/user inbound event. */
export async function recordNotificationProviderEvent(
  db: Database,
  input: NormalizedNotificationProviderEvent,
): Promise<z.input<typeof NotificationInboundEventOut>> {
  if (input.providerEventId) {
    const [existing] = await db
      .select()
      .from(notificationInboundEvent)
      .where(
        and(
          eq(notificationInboundEvent.channel, input.channel),
          sql`${notificationInboundEvent.payload}->>'providerEventId' = ${input.providerEventId}`,
        ),
      )
      .limit(1);
    if (existing) return toInboundEventOut(existing);
  }

  const delivery = input.deliveryId ? await getDelivery(db, input.deliveryId) : null;
  const notificationId = input.notificationId ?? delivery?.notificationId ?? null;
  const deliveryId = delivery?.id ?? null;
  const receivedAt = input.receivedAt ?? new Date();
  const payload = {
    ...input.payload,
    ...(input.providerEventId ? { providerEventId: input.providerEventId } : {}),
    ...(input.deliveryId && !delivery ? { unresolvedDeliveryId: input.deliveryId } : {}),
  };

  const [created] = await db
    .insert(notificationInboundEvent)
    .values({
      notificationId,
      deliveryId,
      channel: input.channel,
      kind: input.kind,
      from: input.from ?? null,
      payload,
      receivedAt,
    })
    .returning();
  if (!created) throw new Error('Failed to record notification inbound event');

  if (delivery) {
    await applyDeliveryEvent(db, delivery, input, receivedAt);
  }

  return toInboundEventOut(created);
}

/** Normalize an email provider event payload. */
export function normalizeEmailProviderPayload(
  payload: Record<string, unknown>,
): NormalizedNotificationProviderEvent {
  const event = eventName(payload);
  const kind = emailKind(event);
  return {
    providerEventId: providerEventId(payload),
    channel: 'email',
    kind,
    notificationId: stringField(payload, 'notificationId'),
    deliveryId: stringField(payload, 'deliveryId'),
    from: stringField(payload, 'from') ?? stringField(payload, 'recipient'),
    payload: withEvent(payload, event),
    ...(kind === 'bounced' ? { contactPointStatus: 'bounced' } : {}),
    ...(kind === 'complained' ? { contactPointStatus: 'unsubscribed' } : {}),
  };
}

/** Normalize an SMS provider event or inbound user command payload. */
export function normalizeSmsProviderPayload(
  payload: Record<string, unknown>,
): NormalizedNotificationProviderEvent {
  const event = eventName(payload);
  const isStop = event === 'stop' || event === 'unsubscribed';
  const isStart = event === 'start';
  const isFailed = event === 'failed' || event === 'undelivered';
  return {
    providerEventId: providerEventId(payload),
    channel: 'sms',
    kind: isStop ? 'unsubscribed' : event === 'replied' || event === 'reply' ? 'replied' : 'action',
    notificationId: stringField(payload, 'notificationId'),
    deliveryId: stringField(payload, 'deliveryId'),
    from: stringField(payload, 'from'),
    payload: withEvent(payload, event),
    ...(isFailed ? { deliveryStatus: 'failed' } : {}),
    ...(isStop ? { contactPointStatus: 'unsubscribed' } : {}),
    ...(isStart ? { contactPointStatus: 'active' } : {}),
  };
}

/** Normalize a push provider lifecycle callback. */
export function normalizePushProviderPayload(
  payload: Record<string, unknown>,
): NormalizedNotificationProviderEvent {
  const event = eventName(payload);
  const invalid = event === 'invalid_token' || event === 'failed';
  return {
    providerEventId: providerEventId(payload),
    channel: 'push',
    kind: event === 'delivered' ? 'delivered' : 'action',
    notificationId: stringField(payload, 'notificationId'),
    deliveryId: stringField(payload, 'deliveryId'),
    payload: withEvent(payload, event),
    ...(invalid ? { deliveryStatus: 'failed', contactPointStatus: 'disabled' } : {}),
  };
}

async function getDelivery(
  db: Database,
  deliveryId: string,
): Promise<NotificationDeliveryRow | null> {
  const [delivery] = await db
    .select()
    .from(notificationDelivery)
    .where(eq(notificationDelivery.id, deliveryId))
    .limit(1);
  return delivery ?? null;
}

async function applyDeliveryEvent(
  db: Database,
  delivery: NotificationDeliveryRow,
  input: NormalizedNotificationProviderEvent,
  receivedAt: Date,
): Promise<void> {
  const status = input.deliveryStatus ?? deliveryStatusForKind(input.kind);
  if (status) {
    await db
      .update(notificationDelivery)
      .set({
        status,
        ...(status === 'delivered' ? { deliveredAt: receivedAt } : {}),
        ...(status === 'read' ? { readAt: receivedAt } : {}),
        ...(status === 'acted' ? { actedAt: receivedAt } : {}),
        ...(status === 'failed'
          ? { errorCode: providerErrorCode(input), errorMessage: 'Provider reported failure' }
          : {}),
      })
      .where(eq(notificationDelivery.id, delivery.id));
  }

  const destination = delivery.destination;
  const contactPointId = destination.contactPointId;
  const pointStatus = input.contactPointStatus ?? contactPointStatusForKind(input.kind);
  if (contactPointId && pointStatus) {
    await db
      .update(contactPoint)
      .set({
        status: pointStatus,
        ...(pointStatus === 'disabled' ? { disabledAt: receivedAt, primary: false } : {}),
      })
      .where(eq(contactPoint.id, contactPointId));
  }
}

function deliveryStatusForKind(
  kind: NotificationInboundEventKind,
): NotificationDeliveryRow['status'] | null {
  if (kind === 'delivered') return 'delivered';
  if (kind === 'opened') return 'read';
  if (kind === 'clicked' || kind === 'replied' || kind === 'action') return 'acted';
  if (kind === 'bounced') return 'bounced';
  return 'complained';
}

function contactPointStatusForKind(kind: NotificationInboundEventKind): ContactPointStatus | null {
  if (kind === 'bounced') return 'bounced';
  if (kind === 'complained' || kind === 'unsubscribed') return 'unsubscribed';
  return null;
}

function emailKind(event: string): NotificationInboundEventKind {
  if (event === 'delivered' || event === 'delivery') return 'delivered';
  if (event === 'bounce' || event === 'bounced') return 'bounced';
  if (event === 'complaint' || event === 'complained') return 'complained';
  if (event === 'open' || event === 'opened') return 'opened';
  if (event === 'click' || event === 'clicked') return 'clicked';
  if (event === 'reply' || event === 'replied') return 'replied';
  if (event === 'unsubscribe' || event === 'unsubscribed') return 'unsubscribed';
  return 'action';
}

function providerErrorCode(input: NormalizedNotificationProviderEvent): string {
  return stringField(input.payload, 'errorCode') ?? stringField(input.payload, 'event') ?? 'failed';
}

function providerEventId(payload: Record<string, unknown>): string | undefined {
  return (
    stringField(payload, 'providerEventId') ??
    stringField(payload, 'eventId') ??
    stringField(payload, 'id') ??
    stringField(payload, 'messageId')
  );
}

function eventName(payload: Record<string, unknown>): string {
  return (
    stringField(payload, 'event') ??
    stringField(payload, 'type') ??
    stringField(payload, 'eventType') ??
    'action'
  ).toLowerCase();
}

function stringField(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function withEvent(payload: Record<string, unknown>, event: string): Record<string, unknown> {
  return { ...payload, event };
}

function toInboundEventOut(
  row: NotificationInboundEventRow,
): z.input<typeof NotificationInboundEventOut> {
  return {
    id: row.id,
    notificationId: row.notificationId,
    deliveryId: row.deliveryId,
    channel: row.channel,
    kind: row.kind,
    from: row.from,
    payload: row.payload,
    receivedAt: row.receivedAt.toISOString(),
  };
}
