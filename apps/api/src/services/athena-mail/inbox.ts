/** Received email shares the personal Inbox's read state and recovery path. */
import { athenaInboundMessage, db, notification } from '@docket/db';
import { asc, eq, isNull } from 'drizzle-orm';
import { messagePermalink } from '../../routes/athena-mail-store';

type Message = typeof athenaInboundMessage.$inferSelect;

/**
 * Refresh one email's Inbox presentation without resetting its read state or arrival time.
 * @param writer - Use the message writer's transaction when content and presentation change together.
 */
export async function projectMailInboxItem(
  message: Message,
  writer: Pick<typeof db, 'insert'> = db,
): Promise<void> {
  const sender = message.fromName ?? message.fromAddress;
  const body = {
    title: message.title,
    summary: message.snippet ? `${sender} · ${message.snippet}` : sender,
    url: messagePermalink(message.id),
    contextObjectId: message.id,
    contextKind: 'athena_email',
    fromAddress: message.fromAddress,
  };
  await writer
    .insert(notification)
    .values({
      id: message.id,
      userId: message.ownerUserId,
      organizationId: message.organizationId,
      type: 'email',
      body,
      createdAt: message.receivedAt,
    })
    .onConflictDoUpdate({ target: notification.id, set: { body } });
}

/** Recover missing Inbox entries, including messages received before this projection existed. */
export async function recoverMailInboxItems(): Promise<void> {
  const missing = await db
    .select({ message: athenaInboundMessage })
    .from(athenaInboundMessage)
    .leftJoin(notification, eq(notification.id, athenaInboundMessage.id))
    .where(isNull(notification.id))
    .orderBy(asc(athenaInboundMessage.receivedAt))
    .limit(25);
  for (const { message } of missing) await projectMailInboxItem(message);
}
