import type { Database } from '@docket/db';
import type {
  NotificationCategory,
  NotificationChannel,
  NotificationContent,
  NotificationPriority,
  NotificationReplyPolicy,
} from '@docket/notifications';

import { ensureAccountEmailContactPoint } from './contact-point-service';
import { dispatchNotificationIntent, type DispatchNotificationResult } from './dispatcher';
import type { NotificationPreferenceMode } from './preferences';

/** Input for a system-authored notification to one user. */
export interface DispatchSystemUserNotificationInput {
  /** Recipient user id. */
  readonly userId: string;
  /** Authenticated account email to materialize when email is a requested channel. */
  readonly email?: string;
  /** Product category used for policy, preferences, and operational filtering. */
  readonly category: NotificationCategory;
  /** Delivery urgency lane. */
  readonly priority: NotificationPriority;
  /** Requested delivery channels. */
  readonly channels: readonly NotificationChannel[];
  /** User-facing title/subject. */
  readonly subject: string;
  /** Channel-rendered body content. */
  readonly body: NotificationContent;
  /** Reply handling policy for inbound email/SMS replies. */
  readonly replyPolicy?: NotificationReplyPolicy;
  /** Optional authenticated deep link for web inbox projection. */
  readonly webUrl?: string;
  /** Optional idempotency key for retry-safe sends. */
  readonly idempotencyKey?: string;
  /** Whether to apply user-managed category/channel toggles while resolving channels. */
  readonly preferenceMode?: NotificationPreferenceMode;
}

/** Dispatch a system-authored notification to one user through the shared notification service. */
export async function dispatchSystemUserNotification(
  db: Database,
  input: DispatchSystemUserNotificationInput,
): Promise<DispatchNotificationResult> {
  if (input.channels.includes('email')) {
    await ensureAccountEmailContactPoint(db, input.userId, input.email);
  }

  return dispatchNotificationIntent(db, {
    senderType: 'system',
    category: input.category,
    priority: input.priority,
    audience: { type: 'user', userId: input.userId },
    channels: [...input.channels],
    subject: input.subject,
    body: input.body,
    replyPolicy: input.replyPolicy ?? 'none',
    createdBy: 'system',
    ...(input.webUrl ? { webUrl: input.webUrl } : {}),
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    ...(input.preferenceMode ? { preferenceMode: input.preferenceMode } : {}),
  });
}
