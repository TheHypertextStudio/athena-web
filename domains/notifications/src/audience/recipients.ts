import type { NotificationRecipientInput } from './types';

/** Deduplicates recipient snapshot inputs by user id while preserving the first match. */
export function dedupeNotificationRecipients(
  recipients: Iterable<NotificationRecipientInput>,
): readonly NotificationRecipientInput[] {
  const seen = new Set<string>();
  const deduped: NotificationRecipientInput[] = [];

  for (const recipient of recipients) {
    if (seen.has(recipient.userId)) continue;
    seen.add(recipient.userId);
    deduped.push(
      Object.freeze({
        userId: recipient.userId,
        organizationId: recipient.organizationId,
        reason: recipient.reason,
      }),
    );
  }

  return Object.freeze(deduped);
}
