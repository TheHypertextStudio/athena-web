/**
 * Store authenticated mail before projecting it into the owner's shared Inbox.
 *
 * The canonical message survives a failed projection or stream announcement. Provider retries
 * reuse that message and repair its Inbox item; the scheduled sweep also recovers missing items.
 * Email remains context until scheduled admission verifies the enrolled sender and current
 * workspace authority. Eligible requests run as isolated Athena jobs, independently of clients.
 */
import { actor, agentSession, athenaInboundMessage, db, event } from '@docket/db';
import type { InboundMessage, InboundProviderId } from '@docket/mail';
import { snippetOf } from '@docket/mail';
import { and, eq } from 'drizzle-orm';

import { emitInboundEmail } from './event-emit';
import { mailChannelAuthority } from '../services/athena-mail/channel';
import { projectMailInboxItem } from '../services/athena-mail/inbox';
import { automaticMail, ownerMailEligible } from '../services/athena-mail/policy';

import {
  messagePermalink,
  resolveMailboxForRecipients,
  type AthenaInboundMessageRow,
  type AthenaMailboxRow,
} from './athena-mail-store';

/**
 * What delivery concluded.
 *
 * @remarks
 * `duplicate` is a success for the caller (the provider retried; we already have it) but a
 * distinct fact for an operator, which is why it is not folded into `delivered`.
 * `unroutable` means the message authenticated but named nobody we host — a `200` with no
 * effect, because bouncing it would tell a stranger which addresses exist.
 */
export type InboundDeliveryOutcome =
  | { readonly status: 'delivered'; readonly messageId: string; readonly sessionId: string | null }
  | { readonly status: 'duplicate'; readonly messageId: string }
  | { readonly status: 'unroutable' };

/** The title a message with an empty subject gets — application-owned copy, never blank. */
const NO_SUBJECT_TITLE = '(No subject)';

/** What Athena is told when the provider's body read did not land. */
const BODY_UNAVAILABLE = '(The message body has not been retrieved.)';

/**
 * Choose the workspace a received message is filed into.
 *
 * @remarks
 * Preference order, and each step is a real signal rather than a guess: the mailbox's own
 * recorded workspace, then the workspace the owner's Athena conversation is currently focused on,
 * then any workspace the owner is a member of. A person always belongs to at least their personal
 * workspace, so the last step effectively always succeeds; `null` means the account has no
 * workspace at all, and delivery reports that rather than inventing one.
 *
 * @param mailbox - The addressed mailbox.
 * @returns the workspace id, or `null` when the owner has none.
 */
async function resolveDeliveryOrganization(mailbox: AthenaMailboxRow): Promise<string | null> {
  if (mailbox.organizationId) return mailbox.organizationId;

  const [conversation] = await db
    .select({ organizationId: agentSession.contextOrganizationId })
    .from(agentSession)
    .where(
      and(
        eq(agentSession.ownerUserId, mailbox.ownerUserId),
        eq(agentSession.executorKind, 'athena'),
        eq(agentSession.kind, 'chat'),
      ),
    )
    .limit(1);
  if (conversation?.organizationId) return conversation.organizationId;

  const [membership] = await db
    .select({ organizationId: actor.organizationId })
    .from(actor)
    .where(
      and(
        eq(actor.userId, mailbox.ownerUserId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
      ),
    )
    .limit(1);
  return membership?.organizationId ?? null;
}

/**
 * Compose what Athena reads when a message arrives.
 *
 * @remarks
 * A plain-language briefing, not a serialized envelope: it is appended to a conversation a person
 * also reads, so it has to be legible to both. The stored context object's id is named in the
 * first line precisely so Athena can act on it — attaching the message to a task she creates is a
 * tool call against that id, not a special email affordance.
 *
 * @param message - The normalized message.
 * @param storedId - The stored context object's id.
 * @returns the conversation turn's text.
 */
export function composeAthenaBriefing(message: InboundMessage, storedId: string): string {
  const sender = message.fromName
    ? `${message.fromName} <${message.fromAddress}>`
    : message.fromAddress;
  const lines = [
    `An email arrived in your Athena inbox. It is stored as context object ${storedId}.`,
    '',
    `From: ${sender}`,
    `To: ${message.to[0] ?? ''}`,
    `Subject: ${message.subject.trim().length > 0 ? message.subject : NO_SUBJECT_TITLE}`,
    `Received: ${message.receivedAt}`,
  ];
  if (message.attachments.length > 0) {
    lines.push(`Attachments: ${message.attachments.map((file) => file.filename).join(', ')}`);
  }
  lines.push('', message.text ?? BODY_UNAVAILABLE);
  return lines.join('\n');
}

/**
 * Find the stream event this message produced.
 *
 * @remarks
 * `emitInboundEmail` returns nothing (it is best-effort by design and must never fail a domain
 * write), so the id is read back by the identity the emit itself stored: the provider message id
 * lands on `event.external_id`. That read is exact, not a heuristic — the same value keyed the
 * insert's dedupe.
 *
 * @param organizationId - The workspace the event was emitted into.
 * @param providerMessageId - The provider's id for the message.
 * @returns the event id, or `null` when the emit did not land.
 */
async function findStreamEventId(
  organizationId: string,
  providerMessageId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: event.id })
    .from(event)
    .where(
      and(
        eq(event.organizationId, organizationId),
        eq(event.kind, 'email_received'),
        eq(event.externalId, providerMessageId),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * Store, announce and deliver one authenticated inbound message.
 *
 * @param message - The normalized message from the inbound adapter.
 * @param provider - Which adapter received it, recorded as provenance.
 * @returns what delivery concluded (see {@link InboundDeliveryOutcome}).
 */
export async function deliverInboundMail(
  message: InboundMessage,
  provider: InboundProviderId,
): Promise<InboundDeliveryOutcome> {
  const resolved = await resolveMailboxForRecipients(message.to);
  if (!resolved) return { status: 'unroutable' };
  const { mailbox } = resolved;

  const organizationId = await resolveDeliveryOrganization(mailbox);
  if (!organizationId) return { status: 'unroutable' };

  const values = await inboundValues(message, provider, mailbox, resolved.address, organizationId);
  const title = values.title;
  const snippet = values.snippet ?? null;
  const [stored] = await db
    .insert(athenaInboundMessage)
    .values(values)
    .onConflictDoNothing({
      target: [athenaInboundMessage.ownerUserId, athenaInboundMessage.providerMessageId],
    })
    .returning();

  if (!stored) {
    // Repair visibility after a partial delivery without duplicating the message or its runtime job.
    const previous = await findExistingByProviderId(mailbox.ownerUserId, message.providerMessageId);
    /* v8 ignore next -- @preserve the conflict target guarantees the earlier row is present */
    if (!previous) throw new Error('inbound message conflicted with no visible row');
    await projectMailInboxItem(previous);
    return { status: 'duplicate', messageId: previous.id };
  }

  await projectMailInboxItem(stored);
  await emitInboundEmail({
    organizationId,
    userId: mailbox.ownerUserId,
    occurredAt: stored.receivedAt,
    messageId: message.providerMessageId,
    fromAddress: message.fromAddress,
    fromName: message.fromName,
    subject: title,
    snippet,
    hasAttachments: message.attachments.length > 0,
    permalink: messagePermalink(stored.id),
  });
  const streamEventId = await findStreamEventId(organizationId, message.providerMessageId);

  // External mail is context only. Verified owner requests are durably admitted by the sweep.
  if (streamEventId) {
    await db
      .update(athenaInboundMessage)
      .set({ streamEventId })
      .where(eq(athenaInboundMessage.id, stored.id));
  }

  return { status: 'delivered', messageId: stored.id, sessionId: null };
}

/**
 * Read back a message already stored under a provider id.
 *
 * @param ownerUserId - The mailbox owner.
 * @param providerMessageId - The provider's id for the message.
 * @returns the stored row, or `null`.
 */
async function findExistingByProviderId(
  ownerUserId: string,
  providerMessageId: string,
): Promise<AthenaInboundMessageRow | null> {
  const [row] = await db
    .select()
    .from(athenaInboundMessage)
    .where(
      and(
        eq(athenaInboundMessage.ownerUserId, ownerUserId),
        eq(athenaInboundMessage.providerMessageId, providerMessageId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function inboundValues(
  message: InboundMessage,
  provider: InboundProviderId,
  mailbox: AthenaMailboxRow,
  address: string,
  organizationId: string,
): Promise<typeof athenaInboundMessage.$inferInsert> {
  const authority = await mailChannelAuthority(mailbox.id);
  const receivedAt = new Date(message.receivedAt);
  return {
    organizationId,
    ownerUserId: mailbox.ownerUserId,
    mailboxId: mailbox.id,
    provider,
    providerMessageId: message.providerMessageId,
    rfc822MessageId: message.rfc822MessageId,
    processingStatus: inboundStatus(message, authority),
    channelRevision: authority?.revision ?? null,
    headers: { ...message.headers },
    authentication: message.authentication ?? null,
    fromAddress: message.fromAddress,
    fromName: message.fromName,
    toAddress: address,
    title: message.subject.trim() || NO_SUBJECT_TITLE,
    bodyText: message.text,
    bodyHtml: message.html,
    snippet: snippetOf(message.text),
    bodyStatus: message.bodyStatus,
    receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
    attachments: message.attachments.map((file) => ({
      id: file.id,
      filename: file.filename,
      contentType: file.contentType,
    })),
  };
}
function inboundStatus(message: InboundMessage, authority: AthenaMailboxRow | null): string {
  if (message.fromAddress.toLowerCase() !== authority?.ownerAddress) return 'captured';
  if (message.bodyStatus === 'metadata-only') return 'hydrating';
  return ownerMailEligible(message.fromAddress, authority.ownerAddress, message.authentication) &&
    !automaticMail(message.headers ?? {})
    ? 'pending'
    : 'captured';
}
