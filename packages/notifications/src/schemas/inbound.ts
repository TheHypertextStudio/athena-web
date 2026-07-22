import { z } from 'zod';

import { Id } from '@docket/types';
import { NotificationChannel, NotificationInboundEventKind } from './enums';
import { NotificationInstant } from './shared';

/** Normalized provider callback or user reply. */
export const NotificationInboundEventOut = z
  .object({
    id: Id,
    notificationId: Id.nullable(),
    deliveryId: Id.nullable(),
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
