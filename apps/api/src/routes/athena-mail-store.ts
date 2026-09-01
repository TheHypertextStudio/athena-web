/**
 * `@docket/api` — Athena's mailbox and its received-message store.
 *
 * @remarks
 * The one place that knows how an Athena inbox address is minted, how an incoming address is
 * resolved back to a person, and how a received message becomes a stored context object. The
 * webhook edge (`inbound-mail.ts`), the delivery pipeline (`inbound-mail-delivery.ts`) and the
 * owner-facing API (`athena-mail.ts`) all read from here, so there is exactly one definition of
 * "what Athena's address is" and one of "what a received message looks like".
 *
 * The receiving **domain is never stored** — only the address's local part is. Composing the
 * address from `apiHosts.athenaMail` at read time is what makes the final
 * domain a configuration change rather than a code change *and* a data migration.
 */
import { randomBytes } from 'node:crypto';

import {
  athenaInboundMessage,
  athenaMailbox,
  attachment,
  db,
  initiative,
  project,
  task,
} from '@docket/db';
import { apiHosts } from '@docket/env/api';
import { mailboxHostOf, mailboxKeyOf } from '@docket/mail';
import type {
  AthenaMailMessageOut,
  AthenaMailAttachmentTargetOut,
} from '@docket/athena/athena-mail-contract';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';

/** A stored Athena mailbox row. */
export type AthenaMailboxRow = typeof athenaMailbox.$inferSelect;
/** A stored received-message row. */
export type AthenaInboundMessageRow = typeof athenaInboundMessage.$inferSelect;

/**
 * The `attachment.kind` an Athena-received message is linked through.
 *
 * @remarks
 * Named once here so the "attach", "list attachments" and "detach" paths cannot drift apart, and
 * so a reader can grep one constant to find every place Athena mail touches the generic
 * attachment table.
 */
export const ATHENA_MAIL_ATTACHMENT_KIND = 'athena_email' as const;

/**
 * Alphabet for an inbox address's local part.
 *
 * @remarks
 * Crockford-style: no `i`, `l`, `o` or `u`, because these addresses get read aloud, typed off a
 * screen, and written down. Excluding the characters people confuse costs four symbols and
 * removes an entire class of mail that silently goes nowhere.
 */
const KEY_ALPHABET = 'abcdefghjkmnpqrstvwxyz0123456789';

/** Length of a minted address key — 12 symbols over a 32-symbol alphabet is 60 bits. */
const KEY_LENGTH = 12;

/**
 * Mint an unguessable inbox address local part.
 *
 * @remarks
 * Unguessable is the point: an Athena address is a write capability into somebody's assistant, so
 * a derived or sequential local part would let a stranger enumerate mailboxes and inject context
 * into other people's work. Rejection sampling keeps the distribution uniform rather than
 * modulo-biased.
 *
 * @param random - Byte source; injectable so tests can produce a fixed key.
 * @returns a fresh lowercase key.
 */
export function mintMailboxKey(random: (size: number) => Uint8Array = randomBytes): string {
  // Reject draws in the incomplete final block rather than folding them, so every symbol stays
  // equally likely even if the alphabet is later resized to something that does not divide 256.
  const ceiling = 256 - (256 % KEY_ALPHABET.length);
  let key = '';
  while (key.length < KEY_LENGTH) {
    for (const byte of random(KEY_LENGTH)) {
      if (key.length === KEY_LENGTH) break;
      /* v8 ignore next -- @preserve unreachable while KEY_ALPHABET.length (32) evenly divides 256 */
      if (byte >= ceiling) continue;
      /* v8 ignore next -- @preserve defensive: byte % KEY_ALPHABET.length is always a valid index */
      key = `${key}${KEY_ALPHABET[byte % KEY_ALPHABET.length] ?? ''}`;
    }
  }
  return key;
}

/**
 * The configured receiving domain, or `null` when Athena has no inbox yet.
 *
 * @remarks
 * Reads the host contract rather than any literal. `null` is a real, reportable state: until a
 * domain with live MX records is configured there is no address that can receive anything, and
 * printing one anyway would invite mail that bounces.
 *
 * @returns the receiving host, or `null`.
 */
export function athenaMailHost(): string | null {
  return apiHosts.athenaMail ?? null;
}

/**
 * Compose a mailbox's full address.
 *
 * @param mailbox - The mailbox row.
 * @returns the address, or `null` when no receiving domain is configured.
 */
export function mailboxAddress(mailbox: Pick<AthenaMailboxRow, 'key'>): string | null {
  const host = athenaMailHost();
  return host ? `${mailbox.key}@${host}` : null;
}

/**
 * Load or create the caller's mailbox.
 *
 * @remarks
 * Created on first read rather than at signup so a person who never uses the inbox never gets a
 * row, and re-run safely: the unique index on `owner_user_id` is the actual guarantee, and a lost
 * race re-reads the winner's row instead of failing the request.
 *
 * @param ownerUserId - The authenticated owner.
 * @returns the owner's mailbox.
 */
export async function ensureMailbox(ownerUserId: string): Promise<AthenaMailboxRow> {
  const [existing] = await db
    .select()
    .from(athenaMailbox)
    .where(eq(athenaMailbox.ownerUserId, ownerUserId))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(athenaMailbox)
    .values({ ownerUserId, key: mintMailboxKey() })
    .onConflictDoNothing({ target: athenaMailbox.ownerUserId })
    .returning();
  if (created) return created;

  const [raced] = await db
    .select()
    .from(athenaMailbox)
    .where(eq(athenaMailbox.ownerUserId, ownerUserId))
    .limit(1);
  /* v8 ignore next -- @preserve the conflict target guarantees the winner's row exists */
  if (!raced) throw new Error('athena mailbox insert conflicted with no visible row');
  return raced;
}

/**
 * Resolve which mailbox a message was addressed to.
 *
 * @remarks
 * Only addresses on the **configured receiving host** are considered, and only after their
 * `+tag` sub-address is stripped, so `key+newsletters@host` reaches the same person as
 * `key@host`. Addresses on any other domain are ignored outright: the endpoint is public, and
 * accepting a recipient we do not host would let a forwarded message from anywhere claim a
 * Docket mailbox.
 *
 * @param recipients - Every address the message was accepted for.
 * @returns the matched mailbox and the address that matched, or `null` when none did.
 */
export async function resolveMailboxForRecipients(
  recipients: readonly string[],
): Promise<{ mailbox: AthenaMailboxRow; address: string } | null> {
  const host = athenaMailHost();
  if (!host) return null;

  const candidates = new Map<string, string>();
  for (const recipient of recipients) {
    const address = recipient.trim().toLowerCase();
    if (mailboxHostOf(address) !== host) continue;
    const key = mailboxKeyOf(address);
    if (key && !candidates.has(key)) candidates.set(key, address);
  }
  if (candidates.size === 0) return null;

  const rows = await db
    .select()
    .from(athenaMailbox)
    .where(inArray(athenaMailbox.key, [...candidates.keys()]));
  const mailbox = rows[0];
  if (!mailbox) return null;
  /* v8 ignore next -- @preserve defensive: mailbox.key is always one of candidates' own keys */
  return { mailbox, address: candidates.get(mailbox.key) ?? `${mailbox.key}@${host}` };
}

/**
 * Count the entities a received message is attached to, per message.
 *
 * @remarks
 * Reads the generic {@link attachment} table — the same table every other attachable resource
 * uses — rather than a mail-specific join, which is the structural half of "not just emails".
 *
 * @param messageIds - The message ids to count for.
 * @returns a map of message id to attachment count (absent ids have no attachments).
 */
export async function countAttachmentsFor(
  messageIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  if (messageIds.length === 0) return new Map();
  const rows = await db
    .select({ externalId: attachment.externalId })
    .from(attachment)
    .where(
      and(
        eq(attachment.kind, ATHENA_MAIL_ATTACHMENT_KIND),
        inArray(attachment.externalId, [...messageIds]),
      ),
    );
  const counts = new Map<string, number>();
  for (const row of rows) {
    /* v8 ignore next -- @preserve defensive: the query's own IN clause excludes a null externalId */
    if (!row.externalId) continue;
    counts.set(row.externalId, (counts.get(row.externalId) ?? 0) + 1);
  }
  return counts;
}

/**
 * The in-app link to a received message's own surface.
 *
 * @remarks
 * A relative path rather than an absolute URL: it is stored on the stream event and rendered by
 * the web app, which knows its own origin. Storing an origin would bake today's domain into every
 * historical row — exactly the mistake the host contract exists to prevent.
 *
 * @param messageId - The stored message id.
 * @returns the in-app path.
 */
export function messagePermalink(messageId: string): string {
  return `/athena/mail/${messageId}`;
}

/**
 * Project a stored message into its wire shape.
 *
 * @remarks
 * The projection is where the context-object contract becomes visible: `title`, `content`,
 * `source` and `occurredAt` are filled from columns that have nothing to do with mail, and the
 * envelope fields are added alongside. A consumer that only reads the context-object half needs
 * no knowledge that this object arrived by email.
 *
 * @param row - The stored message.
 * @param attachedCount - How many entities it is attached to.
 * @returns the wire representation.
 */
export function toMailMessageOut(
  row: AthenaInboundMessageRow,
  attachedCount: number,
): z.input<typeof AthenaMailMessageOut> {
  return {
    id: row.id,
    kind: 'athena_email',
    organizationId: row.organizationId,
    title: row.title,
    snippet: row.snippet,
    content: row.bodyText,
    contentStatus: row.bodyStatus === 'metadata-only' ? 'metadata-only' : 'complete',
    source: {
      system: 'docket',
      provider: row.provider,
      reference: row.providerMessageId,
      label: row.fromName ?? row.fromAddress,
    },
    occurredAt: row.receivedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    permalink: messagePermalink(row.id),
    fromAddress: row.fromAddress,
    fromName: row.fromName,
    toAddress: row.toAddress,
    bodyHtml: row.bodyHtml,
    attachments: row.attachments.map((file) => ({
      id: file.id,
      filename: file.filename,
      contentType: file.contentType,
    })),
    streamEventId: row.streamEventId,
    attachedCount,
  };
}

/**
 * List the caller's received messages, newest first.
 *
 * @param ownerUserId - The authenticated owner.
 * @param limit - Page size.
 * @returns the messages with their attachment counts.
 */
export async function listOwnedMessages(
  ownerUserId: string,
  limit: number,
): Promise<z.input<typeof AthenaMailMessageOut>[]> {
  const rows = await db
    .select()
    .from(athenaInboundMessage)
    .where(eq(athenaInboundMessage.ownerUserId, ownerUserId))
    .orderBy(desc(athenaInboundMessage.receivedAt), desc(athenaInboundMessage.id))
    .limit(limit);
  const counts = await countAttachmentsFor(rows.map((row) => row.id));
  return rows.map((row) => toMailMessageOut(row, counts.get(row.id) ?? 0));
}

/**
 * List the messages attached to one Docket entity.
 *
 * @remarks
 * The entity-side read: start from the generic {@link attachment} table, then join back to
 * Athena's own store for the content. Deliberately *not* owner-scoped — an attachment is a
 * property of the work, so every member of the workspace that work lives in sees it, the same way
 * they see any other attachment. Owner scoping belongs on the inbox, not on the task.
 *
 * @param subjectType - Which kind of entity.
 * @param subjectId - Its id.
 * @param organizationId - The workspace it belongs to, already checked by the caller.
 * @returns the attached messages, newest received first.
 */
export async function listMessagesAttachedTo(
  subjectType: 'task' | 'project' | 'initiative',
  subjectId: string,
  organizationId: string,
): Promise<z.input<typeof AthenaMailMessageOut>[]> {
  const rows = await db
    .select({ message: athenaInboundMessage })
    .from(attachment)
    .innerJoin(athenaInboundMessage, eq(attachment.externalId, athenaInboundMessage.id))
    .where(
      and(
        eq(attachment.kind, ATHENA_MAIL_ATTACHMENT_KIND),
        eq(attachment.organizationId, organizationId),
        eq(attachment.subjectType, subjectType),
        eq(attachment.subjectId, subjectId),
      ),
    )
    .orderBy(desc(athenaInboundMessage.receivedAt));
  const counts = await countAttachmentsFor(rows.map((row) => row.message.id));
  return rows.map((row) => toMailMessageOut(row.message, counts.get(row.message.id) ?? 0));
}

/**
 * Load one of the caller's received messages.
 *
 * @remarks
 * Filtered by owner, so another person's message id reads as absent rather than forbidden — the
 * same existence-hiding rule the rest of the personal surface follows.
 *
 * @param ownerUserId - The authenticated owner.
 * @param id - The message id.
 * @returns the row, or `null`.
 */
export async function loadOwnedMessage(
  ownerUserId: string,
  id: string,
): Promise<AthenaInboundMessageRow | null> {
  const [row] = await db
    .select()
    .from(athenaInboundMessage)
    .where(and(eq(athenaInboundMessage.id, id), eq(athenaInboundMessage.ownerUserId, ownerUserId)))
    .limit(1);
  return row ?? null;
}

/**
 * List the Docket entities one received message is attached to.
 *
 * @remarks
 * Resolves each subject's current title so the surface can say *what* the message is attached
 * to, not just that it is attached to something with an id. A subject that no longer exists is
 * dropped rather than rendered as a dangling row.
 *
 * @param messageId - The stored message id.
 * @returns the attachment targets, oldest first.
 */
export async function listAttachmentTargets(
  messageId: string,
): Promise<z.input<typeof AthenaMailAttachmentTargetOut>[]> {
  const rows = await db
    .select()
    .from(attachment)
    .where(
      and(eq(attachment.kind, ATHENA_MAIL_ATTACHMENT_KIND), eq(attachment.externalId, messageId)),
    );
  if (rows.length === 0) return [];

  const titles = new Map<string, string>();
  const byType = (type: 'task' | 'project' | 'initiative'): string[] =>
    rows.filter((row) => row.subjectType === type).map((row) => row.subjectId);

  const taskIds = byType('task');
  if (taskIds.length > 0) {
    for (const row of await db
      .select({ id: task.id, title: task.title })
      .from(task)
      .where(inArray(task.id, taskIds))) {
      titles.set(`task:${row.id}`, row.title);
    }
  }
  const projectIds = byType('project');
  if (projectIds.length > 0) {
    for (const row of await db
      .select({ id: project.id, name: project.name })
      .from(project)
      .where(inArray(project.id, projectIds))) {
      titles.set(`project:${row.id}`, row.name);
    }
  }
  const initiativeIds = byType('initiative');
  if (initiativeIds.length > 0) {
    for (const row of await db
      .select({ id: initiative.id, name: initiative.name })
      .from(initiative)
      .where(inArray(initiative.id, initiativeIds))) {
      titles.set(`initiative:${row.id}`, row.name);
    }
  }

  return rows
    .map((row) => {
      const title = titles.get(`${row.subjectType}:${row.subjectId}`);
      return title === undefined
        ? null
        : {
            attachmentId: row.id,
            subjectType: row.subjectType,
            subjectId: row.subjectId,
            subjectTitle: title,
            organizationId: row.organizationId,
            createdAt: row.createdAt.toISOString(),
          };
    })
    .filter((entry): entry is z.input<typeof AthenaMailAttachmentTargetOut> => entry !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
