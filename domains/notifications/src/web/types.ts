import type { NotificationCategory, NotificationContent } from '../schemas';

/** Inbox event types the notification service can project into the existing Hub inbox. */
export type NotificationWebProjectionType =
  | 'mention'
  | 'assignment'
  | 'approval_request'
  | 'status_change'
  | 'comment'
  | 'invitation'
  | 'agent_session'
  | 'connector_sync_failed'
  | 'connector_needs_reauth'
  | 'automation'
  | 'service_announcement';

/** Display payload written to the existing `notification.body` JSON column. */
export interface NotificationWebProjectionBody {
  /** Inbox headline. */
  readonly title: string;
  /** Optional supporting summary. */
  readonly summary?: string;
  /** Optional authenticated deep link. */
  readonly url?: string;
  /** Product notification category that produced this projection. */
  readonly category?: NotificationCategory;
  /** Future projection metadata. */
  readonly [key: string]: unknown;
}

/** Input needed to render a durable notification intent into the web inbox projection. */
export interface NotificationWebProjectionInput {
  /** Product category carried by the durable notification intent. */
  readonly category: NotificationCategory;
  /** Inbox headline. */
  readonly subject: string;
  /** Intent body used to derive the inbox summary. */
  readonly body: NotificationContent;
  /** Optional authenticated deep link for the inbox row. */
  readonly url?: string;
}

/** Existing Hub inbox projection for one web-channel notification delivery. */
export interface NotificationWebProjection {
  /** Inbox event type used by filters, icons, and grouping. */
  readonly type: NotificationWebProjectionType;
  /** Display payload written to the existing `notification` table. */
  readonly body: NotificationWebProjectionBody;
}
