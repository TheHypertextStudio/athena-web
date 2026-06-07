/**
 * `@docket/types` — Notification slice DTOs.
 *
 * @remarks
 * A Notification is a cross-org message surfaced in the caller's Hub inbox; its
 * `userId` is the recipient and it carries an optional originating `organizationId`
 * (org-chipped in the inbox). The body always carries a `title` plus type-specific
 * fields. Notifications are read-only over the API surface aside from marking read.
 */
import { z } from 'zod';

import { NotificationId, OrganizationId } from './primitives';

/** Notification kinds surfaced in the cross-org Hub inbox. */
export const NotificationType = z.enum([
  'mention',
  'assignment',
  'approval_request',
  'status_change',
  'comment',
  'invitation',
  'agent_session',
]);
/** Notification-type value. */
export type NotificationType = z.infer<typeof NotificationType>;

/** Notification payload; `title` is required, the rest is type-specific. */
export const NotificationBody = z
  .looseObject({
    title: z.string(),
    summary: z.string().optional(),
    url: z.string().optional(),
  })
  .meta({ id: 'NotificationBody', description: "A notification's display payload." });
/** Notification-body value. */
export type NotificationBody = z.infer<typeof NotificationBody>;

/** Full notification representation returned by the cross-org inbox read. */
export const NotificationOut = z
  .object({
    id: NotificationId,
    userId: z.string(),
    organizationId: OrganizationId.nullable().optional(),
    type: NotificationType,
    body: NotificationBody,
    readAt: z.string().nullable().optional(),
    createdAt: z.string(),
  })
  .meta({ id: 'NotificationOut', description: 'A cross-org Hub inbox notification.' });
/** Notification representation value. */
export type NotificationOut = z.infer<typeof NotificationOut>;
