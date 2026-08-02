/**
 * `@docket/api` — what happens to a message after it has been authenticated.
 *
 * @remarks
 * One function, {@link deliverInboundMail}, and it does four things in a fixed order, each of
 * which is allowed to fail without losing the ones before it:
 *
 * 1. **Store it.** The message becomes a row in `athena_inbound_message` — Athena's own store,
 *    deliberately not the connector tables synced mail lives in. Idempotent on
 *    `(owner, provider message id)`, so a provider retry is a no-op rather than a duplicate.
 * 2. **Announce it.** `emitInboundEmail` puts it in the universal inbox stream through the same
 *    event substrate every other channel uses — one feed, chronologically interleaved, not an
 *    email-only tab.
 * 3. **Deliver it to Athena.** The message is appended to the caller's one open Athena
 *    conversation through {@link postReplyAndResume} — the *same* shared ingress the chat door
 *    uses. There is no email-specific handler, no email-specific queue and no bypass around tool
 *    dispatch: from the loop's point of view a received email is a message on the conversation,
 *    so everything Athena can do about a chat message she can do about an email.
 * 4. **Record the links back.** The stream event id and the session id are stamped onto the
 *    stored row so the context object, its inbox entry and the conversation all point at each
 *    other.
 *
 * Steps 2–4 are best-effort *around a committed row*: if the stream write or Athena's turn fails,
 * the message is still stored, still visible and still attachable. The opposite order — announce
 * then store — would be able to show a person an email that does not exist.
 */
import { actor, agentSession, athenaInboundMessage, db, event } from '@docket/db';
import type { InboundMessage, InboundProviderId } from '@docket/mail';
import { snippetOf } from '@docket/mail';
import { and, eq } from 'drizzle-orm';

import { emitInboundEmail } from './event-emit';
import { resolveCanonicalConversation } from './agent-dispatch';
import { postReplyAndResume } from './agent-session-runner';
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

  const title = message.subject.trim().length > 0 ? message.subject : NO_SUBJECT_TITLE;
  const snippet = snippetOf(message.text);
  const receivedAt = new Date(message.receivedAt);

  const [stored] = await db
    .insert(athenaInboundMessage)
    .values({
      organizationId,
      ownerUserId: mailbox.ownerUserId,
      mailboxId: mailbox.id,
      provider,
      providerMessageId: message.providerMessageId,
      rfc822MessageId: message.rfc822MessageId,
      fromAddress: message.fromAddress,
      fromName: message.fromName,
      toAddress: resolved.address,
      title,
      bodyText: message.text,
      bodyHtml: message.html,
      snippet,
      bodyStatus: message.bodyStatus,
      receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
      attachments: message.attachments.map((file) => ({
        id: file.id,
        filename: file.filename,
        contentType: file.contentType,
      })),
    })
    .onConflictDoNothing({
      target: [athenaInboundMessage.ownerUserId, athenaInboundMessage.providerMessageId],
    })
    .returning();

  if (!stored) {
    // A provider retry, or the same message delivered twice. The first delivery already stored,
    // announced and delivered it; repeating any of that would double-post to the conversation.
    const previous = await findExistingByProviderId(mailbox.ownerUserId, message.providerMessageId);
    /* v8 ignore next -- @preserve the conflict target guarantees the earlier row is present */
    if (!previous) throw new Error('inbound message conflicted with no visible row');
    return { status: 'duplicate', messageId: previous.id };
  }

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

  // The shared ingress. `resolveCanonicalConversation` is the one door every Athena entry point
  // uses, and `postReplyAndResume` is the same write+resume the chat door performs — an email is
  // a message on the conversation, so nothing here is email-specific.
  let sessionId: string | null = null;
  try {
    const conversation = await resolveCanonicalConversation(mailbox.ownerUserId, organizationId);
    await postReplyAndResume(
      organizationId,
      conversation.id,
      null,
      composeAthenaBriefing(message, stored.id),
    );
    sessionId = conversation.id;
  } catch {
    // The message is stored and visible; a failed turn must not lose it. Athena picks the
    // conversation up on the next message either way, because the append is what she reads.
  }

  if (streamEventId || sessionId) {
    await db
      .update(athenaInboundMessage)
      .set({
        ...(streamEventId ? { streamEventId } : {}),
        ...(sessionId ? { sessionId } : {}),
      })
      .where(eq(athenaInboundMessage.id, stored.id));
  }

  return { status: 'delivered', messageId: stored.id, sessionId };
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
