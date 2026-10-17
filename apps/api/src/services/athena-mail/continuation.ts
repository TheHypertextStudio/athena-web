import { mailAttachmentContext } from './attachments';
import { mailChannelAuthority } from './channel';
import { ownerMailEligible, automaticMail } from './policy';
/** Owner email can answer ordinary data questions; approvals always stay in signed-in Docket. */
import type { athenaMailbox } from '@docket/db';
import {
  agentElicitation,
  agentSession,
  agentSessionRun,
  athenaInboundMessage,
  athenaMailOutbox,
  sessionActivity,
  db,
} from '@docket/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { answerElicitation } from '../elicitation-service';
import {
  queueWaitingAthenaWake,
  wakeWaitingAthenaGeneration,
  asynchronousRunnerEnabled,
} from '../../agent/async-runner';
import { resumeSessionExecution } from '../../agent/loop';
import { mailReferences } from './policy';
import { mailboxAddress } from '../../routes/athena-mail-store';
import type { AsyncDispatchDependencies } from '../../agent/async-runner';
type Inbound = typeof athenaInboundMessage.$inferSelect;
type Mailbox = typeof athenaMailbox.$inferSelect;
/** Strip conventional quoted email below the owner's fresh answer; never infer action approval. */
export function ownerReplyText(body: string): string {
  return (
    body
      .split(/\n(?:On .{1,500}wrote:|>{1,}|-{2,}\s*(?:Original|Forwarded) message)/i)[0]
      ?.trim() ?? ''
  );
}
/** Correlate an enrolled sender's reply to exactly one pending text question and record a durable continuation. */
export async function prepareMailContinuation(
  message: Inbound,
  mailbox: Mailbox,
): Promise<boolean> {
  const references = mailReferences(message.headers);
  if (!references.length) return false;
  const previous = await db
    .select()
    .from(athenaMailOutbox)
    .where(
      and(
        eq(athenaMailOutbox.mailboxId, mailbox.id),
        eq(athenaMailOutbox.channelRevision, mailbox.revision),
        eq(athenaMailOutbox.externalRecipient, false),
        inArray(sql<string>`${athenaMailOutbox.headers}->>'Message-ID'`, references),
      ),
    )
    .orderBy(desc(athenaMailOutbox.createdAt))
    .limit(1);
  const sessionId = previous[0]?.sessionId;
  if (!sessionId) return false;
  const [question] = await db
    .select()
    .from(agentElicitation)
    .where(
      and(
        eq(agentElicitation.sessionId, sessionId),
        eq(agentElicitation.askedUserId, mailbox.ownerUserId),
        eq(agentElicitation.status, 'pending'),
      ),
    )
    .orderBy(desc(agentElicitation.createdAt))
    .limit(1);
  if (question?.spec.kind !== 'text' || question.timeoutPolicy === 'destructive') return false;
  await db
    .update(athenaInboundMessage)
    .set({
      processingStatus: 'answering',
      sessionId,
      threadId: question.id,
      channelRevision: mailbox.revision,
    })
    .where(
      and(
        eq(athenaInboundMessage.id, message.id),
        eq(athenaInboundMessage.processingStatus, 'pending'),
      ),
    );
  return true;
}
/** Recover a typed answer and runner wake across either crash boundary without inventing a new task. */
export async function continueMailQuestion(
  message: Inbound,
  resume: (
    sessionId: string,
    organizationId: string,
    questionId: string,
  ) => Promise<unknown> = resumeMailQuestion,
): Promise<void> {
  if (!(await ownerContinuationAuthorized(message))) {
    await db
      .update(athenaInboundMessage)
      .set({ processingStatus: 'canceled' })
      .where(eq(athenaInboundMessage.id, message.id));
    return;
  }
  if (!message.threadId || !message.sessionId) return;
  const [question] = await db
    .select()
    .from(agentElicitation)
    .where(
      and(
        eq(agentElicitation.id, message.threadId),
        eq(agentElicitation.sessionId, message.sessionId),
        eq(agentElicitation.askedUserId, message.ownerUserId),
      ),
    );
  if (question?.spec.kind !== 'text' || question.timeoutPolicy === 'destructive') return;
  const value = ownerReplyText(message.bodyText ?? '');
  if (!(await recordTextAnswer(message, question, value))) return;
  if (message.attachments.length)
    await db
      .insert(sessionActivity)
      .values({
        id: `mail-attachment-context:${message.id}`,
        sessionId: message.sessionId,
        organizationId: null,
        type: 'response',
        body: {
          author: 'user',
          provenance: 'email',
          elicitationId: question.id,
          text: `${mailAttachmentContext(message).slice(0, 20000)}\nAttachment context is bounded to the first 20,000 characters; any additional content is omitted.`,
        },
      })
      .onConflictDoNothing();

  // Keep the original operation recoverable if resumed inline generation crashes midway.
  await db
    .update(athenaInboundMessage)
    .set({ processingStatus: 'running' })
    .where(
      and(
        eq(athenaInboundMessage.sessionId, message.sessionId),
        eq(athenaInboundMessage.processingStatus, 'waiting'),
      ),
    );
  await resume(message.sessionId, message.organizationId, question.id);
  await db
    .update(athenaInboundMessage)
    .set({ processingStatus: 'continued' })
    .where(eq(athenaInboundMessage.id, message.id));
}

/** Persist the asynchronous wake before delivery and tolerate a previously consumed answer. */
export async function resumeMailQuestion(
  sessionId: string,
  organizationId: string,
  questionId: string,
  dependencies?: AsyncDispatchDependencies,
): Promise<void> {
  const [latestQuestion] = await db
    .select()
    .from(agentElicitation)
    .where(eq(agentElicitation.sessionId, sessionId))
    .orderBy(desc(agentElicitation.createdAt), desc(agentElicitation.id))
    .limit(1);
  // A later question proves this answer was consumed. Never wake that later question on replay.
  if (latestQuestion?.id !== questionId) return;
  if (asynchronousRunnerEnabled(dependencies?.config)) {
    const [run] = await db
      .select()
      .from(agentSessionRun)
      .where(eq(agentSessionRun.sessionId, sessionId))
      .orderBy(desc(agentSessionRun.generation))
      .limit(1);
    if (run?.status !== 'waiting') return;
    await queueWaitingAthenaWake(sessionId);
    await wakeWaitingAthenaGeneration(sessionId, dependencies);
    return;
  }
  const [session] = await db.select().from(agentSession).where(eq(agentSession.id, sessionId));
  if (session?.status === 'awaiting_input') await resumeSessionExecution(organizationId, sessionId);
}

async function ownerContinuationAuthorized(message: Inbound): Promise<boolean> {
  const mailbox = await mailChannelAuthority(message.mailboxId, message.channelRevision ?? -1);
  if (!mailbox) return false;
  return (
    ownerMailEligible(
      message.fromAddress,
      mailbox.ownerAddress ?? '',
      message.authentication ?? undefined,
    ) && !automaticMail(message.headers)
  );
}
async function recordTextAnswer(
  message: Inbound,
  question: typeof agentElicitation.$inferSelect,
  value: string,
): Promise<boolean> {
  if (question.status === 'answered' && question.answer === value) return true;
  if (question.status === 'pending') {
    const result = await answerElicitation({
      elicitationId: question.id,
      userId: message.ownerUserId,
      value,
    });
    if (result.ok) return true;
    const mailbox = await mailChannelAuthority(message.mailboxId, message.channelRevision ?? -1);
    if (mailbox)
      await db
        .insert(athenaMailOutbox)
        .values({
          id: `mail-answer-${message.id}`,
          ownerUserId: message.ownerUserId,
          mailboxId: mailbox.id,
          inboundMessageId: message.id,
          sessionId: message.sessionId,
          channelRevision: mailbox.revision,
          toAddress: mailbox.ownerAddress ?? '',
          subject: `Re: ${message.title}`,
          bodyText:
            'Your reply did not meet the question’s required format. Reply again with a shorter plain-text answer, or answer in Docket. The original question is still waiting.',
          responseStage: 'invalid-answer',
          headers: {
            'Message-ID': `<athena-${message.id}-invalid-answer@${mailboxAddress(mailbox)?.split('@')[1]}>`,
            ...(message.rfc822MessageId
              ? {
                  'In-Reply-To': message.rfc822MessageId,
                  References: [message.headers['references'], message.rfc822MessageId]
                    .filter(Boolean)
                    .join(' ')
                    .slice(-8000),
                }
              : {}),
            'Auto-Submitted': 'auto-replied',
          },
        })
        .onConflictDoNothing();
  }
  await db
    .update(athenaInboundMessage)
    .set({ processingStatus: 'captured' })
    .where(eq(athenaInboundMessage.id, message.id));
  return false;
}
