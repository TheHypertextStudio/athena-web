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
  'connector_sync_failed',
  'connector_needs_reauth',
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

/**
 * Query filters for the cross-org inbox list (`GET /notifications`).
 *
 * @remarks
 * All filters are optional and AND-combined. `unreadOnly` arrives as a query string
 * (`"true"`/`"false"`/`"1"`/`"0"`), so it is coerced with {@link z.stringbool} rather
 * than {@link z.boolean} (which would reject the string). `organizationId` narrows the
 * inbox to one org's notifications; `type` narrows to a single {@link NotificationType}.
 */
export const NotificationListQuery = z
  .object({
    /** When true, return only unread (`readAt IS NULL`) notifications. */
    unreadOnly: z.stringbool().optional(),
    /** Restrict to a single originating organization. */
    organizationId: OrganizationId.optional(),
    /** Restrict to a single notification kind. */
    type: NotificationType.optional(),
  })
  .meta({ id: 'NotificationListQuery', description: 'Cross-org inbox list filters.' });
/** Inbox list-query value. */
export type NotificationListQuery = z.infer<typeof NotificationListQuery>;

/**
 * The caller's cross-org unread attention counts (`GET /notifications/count`).
 *
 * @remarks
 * Feeds the rail attention badges. `unread` is every unread notification across the
 * caller's orgs; `pendingApprovals` is the subset of those whose `type` is
 * `approval_request` (the actionable approval queue surfaced in the Inbox).
 */
export const NotificationCount = z
  .object({
    /** Total unread notifications across every org the caller belongs to. */
    unread: z.number().int(),
    /** Unread notifications of type `approval_request` (the pending approval queue). */
    pendingApprovals: z.number().int(),
  })
  .meta({ id: 'NotificationCount', description: 'Cross-org unread attention counts.' });
/** Unread-count value. */
export type NotificationCount = z.infer<typeof NotificationCount>;

/**
 * Body for the bulk mark-all-read action (`POST /notifications/read-all`).
 *
 * @remarks
 * Both filters are optional and AND-combined: with no body the caller's entire inbox is
 * marked read; `organizationId` scopes the bulk action to one org, `type` to one kind.
 * Already-read notifications are left untouched (only `readAt IS NULL` rows are updated).
 */
export const NotificationReadAll = z
  .object({
    /** Restrict the bulk mark-read to a single originating organization. */
    organizationId: OrganizationId.optional(),
    /** Restrict the bulk mark-read to a single notification kind. */
    type: NotificationType.optional(),
  })
  .meta({ id: 'NotificationReadAll', description: 'Bulk mark-all-read filters.' });
/** Mark-all-read body value. */
export type NotificationReadAll = z.infer<typeof NotificationReadAll>;

/** Result of a bulk mark-all-read: the number of notifications transitioned to read. */
export const NotificationReadAllResult = z
  .object({
    /** How many unread notifications were marked read. */
    updated: z.number().int(),
  })
  .meta({ id: 'NotificationReadAllResult', description: 'Count of notifications marked read.' });
/** Mark-all-read result value. */
export type NotificationReadAllResult = z.infer<typeof NotificationReadAllResult>;

/**
 * Body for the one-tap inbox act action (`POST /notifications/:id/act`).
 *
 * @remarks
 * A low-risk inline action taken on a notification directly from the Inbox (e.g.
 * acknowledging or approving). Acting marks the notification handled (read); the
 * `action` string names the inline action invoked by the client.
 */
export const NotificationAct = z
  .object({
    /** The inline action being taken on the notification (e.g. `acknowledge`). */
    action: z.string().min(1),
  })
  .meta({ id: 'NotificationAct', description: 'One-tap inbox act body.' });
/** Notification-act body value. */
export type NotificationAct = z.infer<typeof NotificationAct>;
