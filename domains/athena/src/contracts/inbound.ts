/** Versioned personal app/device ingress, with independently validated event families. */
import { z } from 'zod';
import {
  DeviceNotificationIn,
  DeviceNotificationRemovalIn,
  DeviceNotificationItemResult,
  DeviceNotificationSourceParam,
} from './device-notification';

/** A platform notification captured by a registered device. */
export const PlatformNotificationCaptured = z
  .object({
    id: DeviceNotificationIn.shape.id,
    type: z.literal('platform.notification.captured'),
    occurredAt: DeviceNotificationIn.shape.capturedAt,
    payload: DeviceNotificationIn,
  })
  .refine(
    (event) => event.id === event.payload.id && event.occurredAt === event.payload.capturedAt,
  );
/** A platform notification removed from the notification shade. */
export const PlatformNotificationRemoved = z
  .object({
    id: DeviceNotificationRemovalIn.shape.id,
    type: z.literal('platform.notification.removed'),
    occurredAt: DeviceNotificationRemovalIn.shape.removedAt,
    payload: DeviceNotificationRemovalIn,
  })
  .refine((event) => event.id === event.payload.id && event.occurredAt === event.payload.removedAt);
/** The supported ingress event variants. */
export const PersonalInboundEvent = z.discriminatedUnion('type', [
  PlatformNotificationCaptured,
  PlatformNotificationRemoved,
]);
/** A supported ingress event. */
export type PersonalInboundEvent = z.infer<typeof PersonalInboundEvent>;
/** Envelope fallback permits per-event rejection of unknown or malformed payloads. */
const UnreadableEvent = z.looseObject({ id: z.string().min(1).max(64) });
/** One bounded, versioned upload from a registered personal source. */
export const PersonalInboundBatchIn = z
  .object({
    schemaVersion: z.literal(1),
    sourceId: DeviceNotificationSourceParam.shape.deviceId,
    events: z.array(z.union([PersonalInboundEvent, UnreadableEvent])).max(300),
  })
  .superRefine((batch, ctx) => {
    for (const [type, limit] of [
      ['platform.notification.captured', 100],
      ['platform.notification.removed', 200],
    ] as const) {
      if (batch.events.filter((event) => event.type === type).length > limit) {
        ctx.addIssue({ code: 'custom', path: ['events'], message: `Too many ${type} events.` });
      }
    }
  })
  .meta({ id: 'PersonalInboundBatchIn' });
/** Personal ingress input. */
export type PersonalInboundBatchIn = z.infer<typeof PersonalInboundBatchIn>;
/** Ordered durable settlement receipts, including invalid events. */
export const PersonalInboundBatchOut = z
  .object({ events: z.array(DeviceNotificationItemResult) })
  .meta({ id: 'PersonalInboundBatchOut' });
/** Personal ingress receipts. */
export type PersonalInboundBatchOut = z.infer<typeof PersonalInboundBatchOut>;
/** Explicit personal notification-triage preference. */
export const NotificationTriageSettingsIn = z
  .strictObject({ enabled: z.boolean() })
  .meta({ id: 'NotificationTriageSettingsIn' });
/** Server-recorded consent; absent or disabled settings never enable triage. */
export const NotificationTriageSettingsOut = z
  .object({ enabled: z.boolean(), enabledAt: z.number().int().nullable() })
  .meta({ id: 'NotificationTriageSettingsOut' });
/** Notification triage preference output. */
export type NotificationTriageSettingsOut = z.infer<typeof NotificationTriageSettingsOut>;
