import type { z } from 'zod';

import type { NotificationIntentCreate } from '../schemas';

/** Minimal input needed to evaluate notification creation policy. */
export type NotificationPolicyInput = Pick<
  z.input<typeof NotificationIntentCreate>,
  'senderType' | 'category' | 'audience' | 'channels'
>;

/** Denial reasons emitted by notification creation policy. */
export type NotificationPolicyDenyReason =
  | 'all_users_requires_staff_sender'
  | 'category_requires_system_or_staff_sender'
  | 'marketing_requires_dedicated_consent_surface'
  | 'category_channel_disallowed';

/** Reasons a notification intent must be reviewed before send. */
export type NotificationApprovalReason = 'sms_multi_recipient';

/** Staff approval requirement produced by notification policy. */
export interface NotificationApprovalRequirement {
  /** Whether approval is required before send. */
  readonly required: boolean;
  /** Why approval is required. */
  readonly reasons: readonly NotificationApprovalReason[];
  /** Who must approve the send. */
  readonly approver: 'staff' | null;
}

/** Notification creation policy decision. */
export interface NotificationPolicyDecision {
  /** Whether the intent can be created at all. */
  readonly allowed: boolean;
  /** Reasons the intent is blocked. */
  readonly denialReasons: readonly NotificationPolicyDenyReason[];
  /** Approval gate required before delivery, if any. */
  readonly approval: NotificationApprovalRequirement;
}
