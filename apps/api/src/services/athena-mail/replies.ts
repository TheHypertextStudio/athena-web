/** Snapshot responses exclusively from their isolated owner email invocation. */
import {
  agentSession,
  athenaInboundMessage,
  athenaMailOutbox,
  db,
  sessionActivity,
} from '@docket/db';
import type { athenaMailbox } from '@docket/db';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { apiHosts } from '@docket/env/api';
import { mailboxAddress } from '../../routes/athena-mail-store';
import { mailChannelAuthority } from './channel';
type Inbound = typeof athenaInboundMessage.$inferSelect;
type Session = typeof agentSession.$inferSelect;
type Mailbox = typeof athenaMailbox.$inferSelect;
const TERMINAL = new Set(['completed', 'failed', 'canceled']);
async function responseContent(session: Session): Promise<{ body: string; stage: string }> {
  const rows = await db
    .select()
    .from(sessionActivity)
    .where(eq(sessionActivity.sessionId, session.id))
    .orderBy(desc(sessionActivity.createdAt), desc(sessionActivity.id))
    .limit(50);
  if (session.status === 'awaiting_approval') {
    const proposal = rows.find((row) => row.type === 'action' && row.approvalStatus === 'proposed');
    return {
      body: 'I need your approval before taking action. Review the exact proposed action in signed-in Docket.',
      stage: `waiting-${proposal?.id ?? 'approval'}`,
    };
  }
  if (session.status === 'awaiting_input') {
    const question = rows.find((row) => row.type === 'elicitation');
    return {
      body: `${question?.body.text ?? 'I need more information to continue.'}\nReply to this email with your answer for a text question. Other structured choices and all action approvals require signed-in Docket.`,
      stage: `waiting-${question?.id ?? 'input'}`,
    };
  }
  if (session.status === 'failed')
    return {
      body: 'I could not finish this request. Open Docket to review and retry.',
      stage: 'settled',
    };
  return {
    body: rows
      .filter((row) => row.type === 'response' && row.body.author !== 'user')
      .reverse()
      .map((row) => row.body.text ?? '')
      .join('')
      .slice(0, 50000),
    stage: 'settled',
  };
}
function replyIntent(
  message: Inbound,
  session: Session,
  mailbox: Mailbox,
  result: { body: string; stage: string },
): typeof athenaMailOutbox.$inferInsert {
  const references = [message.headers['references'], message.rfc822MessageId]
    .filter(Boolean)
    .join(' ')
    .slice(-8000);
  return {
    ownerUserId: message.ownerUserId,
    mailboxId: mailbox.id,
    inboundMessageId: message.id,
    sessionId: session.id,
    channelRevision: mailbox.revision,
    responseStage: result.stage,
    toAddress: mailbox.ownerAddress ?? '',
    subject: /^re:/i.test(message.title) ? message.title : `Re: ${message.title}`,
    bodyText: `${result.body}\n\n${apiHosts.app}/athena?session=${session.id}`,
    headers: {
      'Message-ID': `<athena-${message.id}-${result.stage}@${mailboxAddress(mailbox)?.split('@')[1]}>`,
      ...(message.rfc822MessageId
        ? { 'In-Reply-To': message.rfc822MessageId, References: references }
        : {}),
      'Auto-Submitted': 'auto-replied',
    },
  };
}
async function prepareReply(message: Inbound, session: Session): Promise<void> {
  const mailbox = await mailChannelAuthority(message.mailboxId, message.channelRevision ?? -1);
  if (!mailbox || session.status === 'canceled') {
    await db
      .update(athenaInboundMessage)
      .set({ processingStatus: 'canceled' })
      .where(eq(athenaInboundMessage.id, message.id));
    return;
  }
  const result = await responseContent(session);
  if (!result.body.trim()) return;
  await db.transaction(async (tx) => {
    await tx
      .insert(athenaMailOutbox)
      .values(replyIntent(message, session, mailbox, result))
      .onConflictDoNothing({
        target: [athenaMailOutbox.inboundMessageId, athenaMailOutbox.responseStage],
      });
    await tx
      .update(athenaInboundMessage)
      .set({
        processingStatus: TERMINAL.has(session.status) ? 'replied' : 'waiting',
        updatedAt: new Date(),
      })
      .where(eq(athenaInboundMessage.id, message.id));
  });
}
/** Prepare bounded, replay-safe email responses for terminal results and human decisions. */
export async function prepareMailReplies(): Promise<number> {
  const rows = await db
    .select({ message: athenaInboundMessage, session: agentSession })
    .from(athenaInboundMessage)
    .innerJoin(agentSession, eq(agentSession.id, athenaInboundMessage.sessionId))
    .where(
      and(
        inArray(athenaInboundMessage.processingStatus, ['running', 'waiting']),
        inArray(agentSession.status, [
          'completed',
          'awaiting_approval',
          'awaiting_input',
          'failed',
          'canceled',
        ]),
      ),
    )
    .orderBy(asc(athenaInboundMessage.updatedAt))
    .limit(25);
  for (const row of rows) await prepareReply(row.message, row.session);
  return rows.length;
}
