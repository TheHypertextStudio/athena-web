import { resolveOutboundAttachments, sameMailAttachmentRefs } from './attachments';
import { MailSendError } from '@docket/mail';
import type { athenaMailbox } from '@docket/db';
import type { SQL } from 'drizzle-orm';
import { AthenaMailOutboxOut } from '@docket/athena/athena-mail-contract';
/** Durable mail output with fixed owner destinations and immutable external-send approval. */
import { randomUUID } from 'node:crypto';
import { athenaMailOutbox, db } from '@docket/db';
import { and, asc, eq, inArray, lte, or, isNull } from 'drizzle-orm';
import { getContainer } from '../../container';
import { mailboxAddress } from '../../routes/athena-mail-store';
import { mailChannelAuthority } from './channel';
import { outboundRetryAllowed } from './policy';

type Outbox = typeof athenaMailOutbox.$inferSelect;
/** Serialize honest provider acceptance separately from actual recipient delivery. */
export function mailOutboxView(row: Outbox): AthenaMailOutboxOut {
  return AthenaMailOutboxOut.parse({
    id: row.id,
    inboundMessageId: row.inboundMessageId,
    sessionId: row.sessionId,
    toAddress: row.toAddress,
    subject: row.subject,
    status: row.status,
    errorCode: row.errorCode,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
  });
}
export { prepareMailReplies } from './replies';
export { recordMailProviderEvent, reconcileMailProviderEvents } from './delivery-events';
import { reconcileMailProviderEvents } from './delivery-events';
async function claimMail(now: Date): Promise<Outbox | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(athenaMailOutbox)
      .where(
        and(
          inArray(athenaMailOutbox.status, ['queued', 'sending']),
          lte(athenaMailOutbox.availableAt, now),
          or(isNull(athenaMailOutbox.leaseExpiresAt), lte(athenaMailOutbox.leaseExpiresAt, now)),
        ),
      )
      .orderBy(asc(athenaMailOutbox.createdAt))
      .limit(1)
      .for('update', { skipLocked: true });
    if (!row) return null;
    const [claimed] = await tx
      .update(athenaMailOutbox)
      .set({
        status: 'sending',
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        firstAttemptAt: row.firstAttemptAt ?? now,
        attempts: row.attempts + 1,
      })
      .where(eq(athenaMailOutbox.id, row.id))
      .returning();
    return claimed ?? null;
  });
}
async function deliverMail(row: Outbox, now: Date): Promise<void> {
  const authority = await mailChannelAuthority(row.mailboxId, row.channelRevision);
  const current = and(
    eq(athenaMailOutbox.id, row.id),
    inArray(athenaMailOutbox.status, ['sending', 'uncertain']),
    eq(athenaMailOutbox.leaseToken, row.leaseToken ?? ''),
  );
  if (!(await operationAllowsDelivery(row))) {
    await revokeMailAttempt(row, current, 'operation_canceled');
    return;
  }
  if (row.externalRecipient && !(await externalSendStillApproved(row))) {
    await revokeMailAttempt(row, current, 'approval_revoked');
    return;
  }
  if (!authority || (!row.externalRecipient && row.toAddress !== authority.ownerAddress)) {
    await revokeMailAttempt(row, current, 'channel_revoked');
    return;
  }
  if (row.firstAttemptAt && !outboundRetryAllowed(row.firstAttemptAt, now)) {
    await db
      .update(athenaMailOutbox)
      .set({ status: 'uncertain', errorCode: 'idempotency_expired' })
      .where(current);
    return;
  }
  await sendMailAttempt(row, authority, now, current);
}
async function revokeMailAttempt(
  row: Outbox,
  current: SQL | undefined,
  errorCode: string,
): Promise<void> {
  await db
    .update(athenaMailOutbox)
    .set({
      // The current claim has not sent yet; earlier attempts may already have reached the provider.
      status: row.attempts > 1 ? 'uncertain' : 'canceled',
      errorCode,
      leaseToken: null,
      leaseExpiresAt: null,
    })
    .where(current);
}
async function sendMailAttempt(
  row: Outbox,
  authority: typeof athenaMailbox.$inferSelect,
  now: Date,
  current: SQL | undefined,
): Promise<void> {
  try {
    const receipt = await getContainer().mailer.send({
      from: `Athena <${mailboxAddress(authority)}>`,
      replyTo: mailboxAddress(authority) ?? '',
      to: row.toAddress,
      subject: row.subject,
      text: row.bodyText,
      headers: row.headers,
      idempotencyKey: `athena-mail-${row.id}`,
      attachments: await resolveOutboundAttachments(
        row.ownerUserId,
        row.mailboxId,
        row.channelRevision,
        row.attachments,
      ),
    });
    await db
      .update(athenaMailOutbox)
      .set({
        status: receipt ? 'sent' : 'uncertain',
        providerMessageId: receipt?.id ?? null,
        errorCode: receipt ? null : 'receipt_missing',
        sentAt: receipt ? now : null,
        leaseToken: null,
        leaseExpiresAt: null,
      })
      .where(current);
  } catch (error) {
    const authority = await mailChannelAuthority(row.mailboxId, row.channelRevision);
    const failure = sendFailureState(row, error, Boolean(authority));
    await db
      .update(athenaMailOutbox)
      .set({
        ...failure,
        availableAt: new Date(now.getTime() + Math.min(30_000 * 2 ** row.attempts, 3600_000)),
        leaseToken: null,
        leaseExpiresAt: null,
      })
      .where(current);
  }
}
function sendFailureState(
  row: Outbox,
  error: unknown,
  authorized: boolean,
): Pick<Outbox, 'status' | 'errorCode'> {
  if (error instanceof MailSendError && error.disposition === 'rejected')
    return { status: 'failed', errorCode: 'provider_rejected' };
  return {
    status: row.attempts >= 8 || !authorized ? 'uncertain' : 'queued',
    errorCode: 'send_failed',
  };
}
/** Drain bounded leased mail intents from scheduled server work, with no open app dependency. */
export async function sweepMailOutbox(now = new Date()): Promise<number> {
  await reconcileMailProviderEvents();
  let count = 0;
  for (; count < 25; count++) {
    const row = await claimMail(now);
    if (!row) break;
    await deliverMail(row, now);
  }
  return count;
}

async function externalSendStillApproved(row: Outbox): Promise<boolean> {
  if (!row.sessionId) return false;
  const { sessionActivity } = await import('@docket/db');
  const [action] = await db
    .select()
    .from(sessionActivity)
    .where(
      and(
        eq(sessionActivity.id, row.id.replace(/^email-action-/, '')),
        eq(sessionActivity.sessionId, row.sessionId),
      ),
    );
  if (!action) return false;
  if (!['applied', 'executing'].includes(action.approvalStatus ?? '')) return false;
  return matchesMailSnapshot(action.body.action?.toolCall?.input, row);
}
function matchesMailSnapshot(input: unknown, row: Outbox): boolean {
  if (!input || typeof input !== 'object') return false;
  const snapshot = input as Record<string, unknown>;
  if (typeof snapshot['to'] !== 'string') return false;
  return (
    snapshot['to'].toLowerCase() === row.toAddress &&
    snapshot['subject'] === row.subject &&
    snapshot['body'] === row.bodyText &&
    sameMailAttachmentRefs(snapshot['attachments'], row.attachments)
  );
}

async function operationAllowsDelivery(row: Outbox): Promise<boolean> {
  if (!row.sessionId) return !row.externalRecipient;
  const { agentSession } = await import('@docket/db');
  const [session] = await db
    .select()
    .from(agentSession)
    .where(and(eq(agentSession.id, row.sessionId), eq(agentSession.ownerUserId, row.ownerUserId)));
  return Boolean(session && session.status !== 'canceled' && !session.interruptedAt);
}
