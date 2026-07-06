import { z } from 'zod';

import { Id } from '@docket/types';
import {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationDestinationType,
} from './enums';
import { NotificationInstant } from './shared';

/** Delivery destination metadata. */
export const NotificationDestination = z
  .object({
    type: NotificationDestinationType,
    valueMasked: z.string().optional(),
    contactPointId: Id.optional(),
  })
  .meta({ id: 'NotificationDestination', description: 'Delivery destination metadata.' });
/** Notification-destination value. */
export type NotificationDestination = z.infer<typeof NotificationDestination>;

/** Per-channel delivery representation. */
export const NotificationDeliveryOut = z
  .object({
    id: Id,
    notificationId: Id,
    recipientId: Id,
    channel: NotificationChannel,
    destination: NotificationDestination,
    status: NotificationDeliveryStatus,
    providerMessageId: z.string().nullable().optional(),
    errorCode: z.string().nullable().optional(),
    errorMessage: z.string().nullable().optional(),
    sentAt: NotificationInstant.nullable().optional(),
    deliveredAt: NotificationInstant.nullable().optional(),
    readAt: NotificationInstant.nullable().optional(),
    actedAt: NotificationInstant.nullable().optional(),
  })
  .meta({ id: 'NotificationDeliveryOut', description: 'One per-channel delivery attempt.' });
/** Notification-delivery representation value. */
export type NotificationDeliveryOut = z.infer<typeof NotificationDeliveryOut>;
