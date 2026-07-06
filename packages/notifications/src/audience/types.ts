import type { NotificationAudience, NotificationRecipientReason } from '../schemas';

/** Selector segment supported by the notification audience resolver. */
export type NotificationAudienceSegment = Extract<
  NotificationAudience,
  { type: 'segment' }
>['segment'];

/** Immutable input used when snapshotting a user into a notification recipient row. */
export interface NotificationRecipientInput {
  /** User that should receive the notification. */
  readonly userId: string;
  /** Organization context that explained the recipient, when applicable. */
  readonly organizationId: string | null;
  /** Why the user was included in the expanded audience. */
  readonly reason: NotificationRecipientReason;
}
