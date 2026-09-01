import { z } from 'zod';

const ulid = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const ownedId = z.string().regex(ulid);
const genericOwnedId = ownedId
  .describe('A 26-char Crockford base-32 ULID matching `^[0-9A-HJKMNP-TV-Z]{26}$`.')
  .meta({ example: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });

/** Notification identifier. */
export const NotificationId = ownedId
  .brand<'NotificationId'>()
  .describe('ULID id of a Notification — one in-app/delivered alert addressed to an actor.');
/** Notification identifier value. */
export type NotificationId = z.infer<typeof NotificationId>;

/** Notification intent identifier. */
export const NotificationIntentId = genericOwnedId.brand<'NotificationIntentId'>();
/** Notification intent identifier value. */
export type NotificationIntentId = z.infer<typeof NotificationIntentId>;

/** Notification recipient identifier. */
export const NotificationRecipientId = genericOwnedId.brand<'NotificationRecipientId'>();
/** Notification recipient identifier value. */
export type NotificationRecipientId = z.infer<typeof NotificationRecipientId>;

/** Notification delivery identifier. */
export const NotificationDeliveryId = genericOwnedId.brand<'NotificationDeliveryId'>();
/** Notification delivery identifier value. */
export type NotificationDeliveryId = z.infer<typeof NotificationDeliveryId>;

/** Notification contact point identifier. */
export const ContactPointId = genericOwnedId.brand<'ContactPointId'>();
/** Notification contact point identifier value. */
export type ContactPointId = z.infer<typeof ContactPointId>;

/** Notification inbound event identifier. */
export const NotificationInboundEventId = genericOwnedId.brand<'NotificationInboundEventId'>();
/** Notification inbound event identifier value. */
export type NotificationInboundEventId = z.infer<typeof NotificationInboundEventId>;
