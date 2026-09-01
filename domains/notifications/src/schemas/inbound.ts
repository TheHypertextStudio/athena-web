import { z } from 'zod';

import { NotificationDeliveryId, NotificationInboundEventId, NotificationIntentId } from '../ids';
import { NotificationChannel, NotificationInboundEventKind } from './enums';
import { NotificationInstant } from './shared';

/** Normalized provider callback or user reply. */
export const NotificationInboundEventOut = z
  .object({
    id: NotificationInboundEventId,
    notificationId: NotificationIntentId.nullable(),
    deliveryId: NotificationDeliveryId.nullable(),
    channel: NotificationChannel,
    kind: NotificationInboundEventKind,
    from: z.string().nullable(),
    payload: z.record(z.string(), z.unknown()),
    receivedAt: NotificationInstant,
  })
  .meta({
    id: 'NotificationInboundEventOut',
    description: 'A normalized notification provider/user inbound event.',
  });
/** Notification-inbound-event representation value. */
export type NotificationInboundEventOut = z.infer<typeof NotificationInboundEventOut>;
