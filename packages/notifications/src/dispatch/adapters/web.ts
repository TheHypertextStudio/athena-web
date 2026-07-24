import type { Database } from '@docket/db';
import { notification } from '@docket/db';
import { renderNotificationWebProjection, type NotificationContent } from '@docket/notifications';

/** Input for writing the existing Hub inbox row for a web-channel delivery. */
export interface DeliverWebNotificationInput {
  /** Durable notification intent id. */
  readonly intentId: string;
  /** Per-channel delivery id that produced this inbox row. */
  readonly deliveryId: string;
  /** Recipient user id. */
  readonly userId: string;
  /** Organization context, when the recipient came from an org audience. */
  readonly organizationId: string | null;
  /** Product notification category. */
  readonly category: Parameters<typeof renderNotificationWebProjection>[0]['category'];
  /** Inbox headline. */
  readonly subject: string;
  /** Intent body used to derive the inbox summary. */
  readonly body: NotificationContent;
  /** Optional authenticated deep link for the inbox row. */
  readonly url?: string;
}

/** Writes the web-channel projection into the existing cross-org Hub inbox table. */
export async function deliverWebNotification(
  db: Database,
  input: DeliverWebNotificationInput,
): Promise<typeof notification.$inferSelect> {
  const projection = renderNotificationWebProjection({
    category: input.category,
    subject: input.subject,
    body: input.body,
    ...(input.url ? { url: input.url } : {}),
  });
  const [row] = await db
    .insert(notification)
    .values({
      intentId: input.intentId,
      deliveryId: input.deliveryId,
      userId: input.userId,
      organizationId: input.organizationId,
      type: projection.type,
      body: projection.body,
    })
    .returning();
  if (!row) throw new Error('Failed to write web notification projection');
  return row;
}
