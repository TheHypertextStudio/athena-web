import { z } from 'zod';

/** Channels the notification service can deliver through. */
export const NotificationChannel = z.enum(['web', 'email', 'sms', 'push']);
/** Notification-channel value. */
export type NotificationChannel = z.infer<typeof NotificationChannel>;

/** Product category, used for user preferences and policy. */
export const NotificationCategory = z.enum([
  'security',
  'account',
  'service_announcement',
  'workflow',
  'digest',
  'billing',
  'marketing',
]);
/** Notification-category value. */
export type NotificationCategory = z.infer<typeof NotificationCategory>;

/** Delivery urgency lane. */
export const NotificationPriority = z.enum(['low', 'normal', 'high', 'urgent']);
/** Notification-priority value. */
export type NotificationPriority = z.infer<typeof NotificationPriority>;

/** Kind of principal that created a notification intent. */
export const NotificationSenderType = z.enum(['system', 'staff', 'org', 'automation']);
/** Notification-sender-type value. */
export type NotificationSenderType = z.infer<typeof NotificationSenderType>;

/** Reply routing policy for inbound email/SMS replies. */
export const NotificationReplyPolicy = z.enum(['none', 'staff_inbox', 'org_admins', 'automation']);
/** Notification-reply-policy value. */
export type NotificationReplyPolicy = z.infer<typeof NotificationReplyPolicy>;

/** Lifecycle state of a notification intent. */
export const NotificationIntentStatus = z.enum([
  'draft',
  'scheduled',
  'queued',
  'sending',
  'sent',
  'partially_failed',
  'failed',
  'canceled',
]);
/** Notification-intent-status value. */
export type NotificationIntentStatus = z.infer<typeof NotificationIntentStatus>;

/** Why a user was included in a recipient snapshot. */
export const NotificationRecipientReason = z.enum([
  'explicit',
  'org_member',
  'segment_match',
  'owner',
  'assignee',
]);
/** Notification-recipient-reason value. */
export type NotificationRecipientReason = z.infer<typeof NotificationRecipientReason>;

/** Why a delivery was suppressed or delayed. */
export const NotificationSuppressionReason = z.enum([
  'user_disabled_channel',
  'quiet_hours',
  'no_verified_contact_point',
  'contact_point_bounced',
  'user_unsubscribed',
  'category_disallows_channel',
  'staff_approval_missing',
  'duplicate_idempotency_key',
  'legal_suppression',
]);
/** Notification-suppression-reason value. */
export type NotificationSuppressionReason = z.infer<typeof NotificationSuppressionReason>;

/** Channel-specific destination kind. */
export const NotificationDestinationType = z.enum(['in_app', 'email', 'phone', 'push_token']);
/** Notification-destination-type value. */
export type NotificationDestinationType = z.infer<typeof NotificationDestinationType>;

/** Lifecycle state of one delivery attempt. */
export const NotificationDeliveryStatus = z.enum([
  'suppressed',
  'queued',
  'sent',
  'delivered',
  'read',
  'acted',
  'failed',
  'bounced',
  'complained',
]);
/** Notification-delivery-status value. */
export type NotificationDeliveryStatus = z.infer<typeof NotificationDeliveryStatus>;

/** User-owned destination kind. */
export const ContactPointType = z.enum(['email', 'phone', 'push_token']);
/** Contact-point-type value. */
export type ContactPointType = z.infer<typeof ContactPointType>;

/** User-owned destination state. */
export const ContactPointStatus = z.enum([
  'pending',
  'active',
  'disabled',
  'bounced',
  'unsubscribed',
]);
/** Contact-point-status value. */
export type ContactPointStatus = z.infer<typeof ContactPointStatus>;

/** Normalized inbound provider/user event kind. */
export const NotificationInboundEventKind = z.enum([
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'complained',
  'replied',
  'unsubscribed',
  'action',
]);
/** Notification-inbound-event-kind value. */
export type NotificationInboundEventKind = z.infer<typeof NotificationInboundEventKind>;
