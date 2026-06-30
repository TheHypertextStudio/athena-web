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
export const NotificationType = z
  .enum([
    'mention',
    'assignment',
    'approval_request',
    'status_change',
    'comment',
    'invitation',
    'agent_session',
    'connector_sync_failed',
    'connector_needs_reauth',
  ])
  .describe(
    'The kind of event a notification represents, which drives its icon, grouping, and inline actions. Values: `mention` (the caller was @-mentioned), `assignment` (a task was assigned to them), `approval_request` (an action awaits their approval — the actionable queue counted by `pendingApprovals`), `status_change` (a watched item changed state), `comment` (a new comment on a followed thread), `invitation` (an org/team invite), `agent_session` (an AI agent session update), `connector_sync_failed` (an integration sync errored), `connector_needs_reauth` (a linked integration must be re-authorized).',
  );
/** Notification-type value. */
export type NotificationType = z.infer<typeof NotificationType>;

/** Notification payload; `title` is required, the rest is type-specific. */
export const NotificationBody = z
  .looseObject({
    title: z
      .string()
      .describe(
        'The notification headline, always present (e.g. "Alex mentioned you in Roadmap").',
      ),
    summary: z
      .string()
      .optional()
      .describe('An optional secondary line giving more context beneath the title.'),
    url: z
      .string()
      .optional()
      .describe(
        'An optional deep link to the originating entity (task, comment, agent session) the notification points at.',
      ),
  })
  .meta({ id: 'NotificationBody', description: "A notification's display payload." });
/** Notification-body value. */
export type NotificationBody = z.infer<typeof NotificationBody>;

/** Full notification representation returned by the cross-org inbox read. */
export const NotificationOut = z
  .object({
    id: NotificationId.describe("The notification's stable unique id."),
    userId: z
      .string()
      .describe(
        'The recipient user id — always the signed-in caller. This is what scopes the inbox; a caller only ever sees rows where `userId` is their own.',
      ),
    organizationId: OrganizationId.nullable()
      .optional()
      .describe(
        'The originating organization, used as the org chip in the cross-org inbox. Null for account-level notifications that belong to no single org.',
      ),
    type: NotificationType.describe(
      'The notification kind (drives icon, grouping, and inline actions).',
    ),
    body: NotificationBody.describe(
      'The display payload: a required `title` plus optional `summary`/`url` and any type-specific extra fields.',
    ),
    readAt: z
      .string()
      .nullable()
      .optional()
      .describe(
        'ISO-8601 instant the notification was marked read (via read/read-all/act), or null while still unread. This single column is the entire read/act state.',
      ),
    createdAt: z
      .string()
      .describe(
        'ISO-8601 instant the notification was created; the inbox is ordered by this, newest first.',
      ),
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
    unreadOnly: z
      .stringbool()
      .optional()
      .describe(
        'When true, return only unread (`readAt IS NULL`) notifications. Arrives as a query string (`"true"`/`"false"`/`"1"`/`"0"`) and is coerced to a boolean. Omitted = include read and unread.',
      ),
    /** Restrict to a single originating organization. */
    organizationId: OrganizationId.optional().describe(
      "Narrow the inbox to a single originating org. Only narrows *within* the caller's own notifications — it cannot widen scope to another user or to an org the caller isn't a member of. Omitted = all orgs.",
    ),
    /** Restrict to a single notification kind. */
    type: NotificationType.optional().describe(
      'Narrow the inbox to a single notification kind (see NotificationType). Omitted = all kinds.',
    ),
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
    unread: z
      .number()
      .int()
      .describe(
        'Total count of unread notifications across every org the caller belongs to. Drives the rail unread badge. >= 0.',
      )
      .meta({ example: 7 }),
    /** Unread notifications of type `approval_request` (the pending approval queue). */
    pendingApprovals: z
      .number()
      .int()
      .describe(
        'Count of unread notifications whose type is `approval_request` — the actionable approval queue. A subset of `unread`. >= 0.',
      )
      .meta({ example: 2 }),
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
    organizationId: OrganizationId.optional().describe(
      "Scope the bulk mark-read to a single org. AND-combined with `type`. Omitted = mark the caller's entire inbox read.",
    ),
    /** Restrict the bulk mark-read to a single notification kind. */
    type: NotificationType.optional().describe(
      'Scope the bulk mark-read to a single notification kind. AND-combined with `organizationId`. Omitted = all kinds.',
    ),
  })
  .meta({ id: 'NotificationReadAll', description: 'Bulk mark-all-read filters.' });
/** Mark-all-read body value. */
export type NotificationReadAll = z.infer<typeof NotificationReadAll>;

/** Result of a bulk mark-all-read: the number of notifications transitioned to read. */
export const NotificationReadAllResult = z
  .object({
    /** How many unread notifications were marked read. */
    updated: z
      .number()
      .int()
      .describe(
        'How many previously-unread notifications were transitioned to read by this call. 0 when there was nothing unread (the operation is idempotent). >= 0.',
      )
      .meta({ example: 5 }),
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
    action: z
      .string()
      .min(1)
      .describe(
        'Names the inline action the client invoked from the inbox (e.g. `acknowledge`, `approve`). Conveys client intent for the transition; it is not persisted — acting simply marks the notification read.',
      )
      .meta({ example: 'acknowledge' }),
  })
  .meta({ id: 'NotificationAct', description: 'One-tap inbox act body.' });
/** Notification-act body value. */
export type NotificationAct = z.infer<typeof NotificationAct>;
