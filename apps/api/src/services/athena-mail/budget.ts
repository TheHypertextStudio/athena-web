/** Bound owner email work before any paid model generation. */
import type { db } from '@docket/db';
import { athenaInboundMessage, athenaMailbox, athenaMailOutbox, agentSession } from '@docket/db';
import { and, count, eq, gt, sql } from 'drizzle-orm';
import { OWNER_MAIL_HOURLY_LIMIT, OWNER_MAIL_BODY_LIMIT } from './policy';
type Inbound = typeof athenaInboundMessage.$inferSelect;
type MailTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Claim a mailbox-serialized hourly admission budget or enqueue one bounded owner notice. */
export async function admitMailBudget(
  tx: MailTransaction,
  message: Inbound,
  mailbox: typeof athenaMailbox.$inferSelect,
): Promise<boolean> {
  await tx
    .select({ id: athenaMailbox.id })
    .from(athenaMailbox)
    .where(eq(athenaMailbox.id, mailbox.id))
    .for('update');
  const [used] = await tx
    .select({ value: count() })
    .from(agentSession)
    .where(
      and(
        eq(agentSession.ownerUserId, mailbox.ownerUserId),
        sql`${agentSession.externalRunRef} LIKE 'athena-mail:%'`,
        gt(agentSession.createdAt, new Date(Date.now() - 3600_000)),
      ),
    );
  const tooLarge = (message.bodyText?.length ?? 0) > OWNER_MAIL_BODY_LIMIT;
  if (!tooLarge && (used?.value ?? 0) < OWNER_MAIL_HOURLY_LIMIT) return true;
  const status = tooLarge ? 'too_large' : 'rate_limited';
  await tx
    .update(athenaInboundMessage)
    .set({ processingStatus: status })
    .where(eq(athenaInboundMessage.id, message.id));
  const id = tooLarge
    ? `mail-limit-${message.id}`
    : `mail-rate-${mailbox.id}-${Math.floor(Date.now() / 3600_000)}`;
  await tx
    .insert(athenaMailOutbox)
    .values({
      id,
      ownerUserId: mailbox.ownerUserId,
      mailboxId: mailbox.id,
      inboundMessageId: message.id,
      channelRevision: mailbox.revision,
      toAddress: mailbox.ownerAddress ?? '',
      subject: `Re: ${message.title}`,
      bodyText: tooLarge
        ? 'This email is too long for Athena to process. Send a shorter request (up to 50,000 characters).'
        : 'Athena has reached the email request limit for this hour. Your email was captured; retry later or continue in Docket.',
      responseStage: 'limit',
      headers: { 'Auto-Submitted': 'auto-replied' },
    })
    .onConflictDoNothing();
  return false;
}
