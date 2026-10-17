/**
 * `@docket/db` — Athena's own mailbox and the messages it receives.
 *
 * @remarks
 * **This is deliberately not where synced mail lives.** Mail that Docket pulls out of a
 * *connected* mailbox stays in the connector constructs — `attachment{kind:'email'}` (an
 * integration-backed pointer whose content remains in Gmail) and `email_suggestion` (a triage
 * proposal derived from a synced thread). Both are keyed by an `integration_id`, both describe
 * something Docket does not own, and both are read through a mailbox the user connected.
 *
 * A message that arrives at *Athena's own address* is a different object with different
 * ownership: Docket received it, Docket holds every byte of it, and no integration is involved.
 * Storing it in the connector tables would mean a single query could not answer "did this arrive
 * natively or did we sync it", would make Athena's mail vanish the moment a user disconnected an
 * unrelated Gmail account (both tables cascade from `integration`), and would inherit
 * `attachment_source_uq`, an index whose whole purpose is deduping *provider* threads.
 *
 * So: two tables here, and the separation is structural rather than conventional.
 *
 * {@link athenaInboundMessage} is modelled as a **context object**, not as an email row. It
 * carries the shape every attachable Docket context object carries — a stable id, a title, its
 * content, its provenance, and its timestamps — and it is attached to work through the ordinary
 * polymorphic {@link attachment} table (`kind = 'athena_email'`, `external_id` = this row's id),
 * exactly like any other attachable thing. There is no mail-specific join table, so nothing about
 * reaching one of these from a task or a project is special-cased to a mail view.
 *
 * Both tables are new; nothing existing is altered, so the migration is additive against live
 * production data.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { genId } from '../id';
import { agentSession } from './agents';
import { user } from './auth';
import { auditColumns, organization } from './identity';

/** A received file and its bounded inert-text processing result. */
export interface AthenaMailAttachmentMeta {
  /** The provider's id for the attachment. */
  id: string;
  /** Filename as the sender's client supplied it. */
  filename: string;
  /** Declared MIME type, when the provider reported one. */
  contentType: string | null;
  /** Ready content is privately stored under a digest-bound immutable key. */
  status?: 'ready' | 'rejected' | 'unavailable';
  digest?: string;
  size?: number;
  blobKey?: string;
  extractedText?: string;
  errorCode?: string;
}

/** Immutable approved attachment identity; never a URL or filesystem path. */
export interface AthenaMailAttachmentSnapshot {
  messageId: string;
  id: string;
  digest: string;
  filename: string;
  contentType: string;
  size: number;
}

/**
 * A person's Athena inbox address.
 *
 * @remarks
 * The address is `{key}@{ATHENA_INBOUND_MAIL_HOST}` — the **host is never stored**, only the
 * local part. That is the whole of the config-driven-domain requirement in one column: moving Athena to her final receiving
 * domain changes one environment variable and zero rows, where a stored full address would mean
 * a data migration (and a window in which half the addresses printed in the UI bounce).
 *
 * `key` is random rather than derived from a name or user id: an inbox address is public by
 * construction (you give it to people so they can write to it), so deriving it would leak the
 * user's identity to anyone who receives one, and a sequential form would let a stranger
 * enumerate every mailbox in the product.
 *
 * `organization_id` is the workspace received mail is filed into. It is nullable because a
 * mailbox belongs to a *person*, who may not have chosen a workspace yet; the receiving path
 * resolves a workspace at delivery time and back-fills it.
 */
export const athenaMailbox = pgTable(
  'athena_mailbox',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** The address's local part. Lowercase, unguessable, stable for the mailbox's lifetime. */
    key: text('key').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    ownerRepliesEnabled: boolean('owner_replies_enabled').notNull().default(false),
    ownerAddress: text('owner_address'),
    revision: integer('revision').notNull().default(0),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('athena_mailbox_key_uq').on(t.key),
    uniqueIndex('athena_mailbox_owner_uq').on(t.ownerUserId),
  ],
);

/**
 * A message received at an Athena inbox address — a first-class, attachable context object.
 *
 * @remarks
 * The context-object contract this row implements, column by column: a stable `id`; a `title`
 * (the subject); its content (`body_text` / `body_html`, with `snippet` as the preview every
 * surface renders); its provenance (`provider`, `provider_message_id`, `rfc822_message_id`,
 * `from_address`, `to_address`); and its timestamps (`received_at` plus the audit columns). A
 * consumer needs none of those to be email-shaped — it reads title, content, source and time,
 * which is why this object can hang off a task or a project without a mail viewer.
 *
 * `body_status` records whether the body was actually retrieved. It exists because the receiving
 * provider's webhook carries metadata only and the body is a second call that can fail: without
 * this column an unretrievable body and a genuinely empty message are the same NULL, and the UI
 * would have to claim one of them. With it, a surface can say the body is still missing instead
 * of implying the sender sent nothing.
 *
 * `stream_event_id` is the link back to this message's entry in the universal inbox stream, and
 * `session_id` is the Athena conversation it was delivered into. Both are set after the fact and
 * are therefore nullable: the row is written first so a crash between the write and the fan-out
 * loses a *link*, never the message.
 */
export const athenaInboundMessage = pgTable(
  'athena_inbound_message',
  {
    ...auditColumns(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    mailboxId: text('mailbox_id')
      .notNull()
      .references(() => athenaMailbox.id, { onDelete: 'cascade' }),
    /** Which inbound adapter received it — `resend` in production, `fixture` offline. */
    provider: text('provider').notNull(),
    /** The provider's id for the message: the idempotency key for redelivery. */
    providerMessageId: text('provider_message_id').notNull(),
    processingStatus: text('processing_status').notNull().default('captured'),
    channelRevision: integer('channel_revision'),
    threadId: text('thread_id'),
    headers: jsonb('headers').$type<Record<string, string>>().notNull().default({}),
    authentication: jsonb('authentication').$type<{ spf: string; dkim: string; dmarc: string }>(),
    /** RFC 5322 `Message-ID`, when the provider surfaced it. */
    rfc822MessageId: text('rfc822_message_id'),
    fromAddress: text('from_address').notNull(),
    fromName: text('from_name'),
    /** The Docket address the message was accepted for, including any `+tag`. */
    toAddress: text('to_address').notNull(),
    /** The context object's title — the subject line, or a stated placeholder when empty. */
    title: text('title').notNull(),
    bodyText: text('body_text'),
    bodyHtml: text('body_html'),
    snippet: text('snippet'),
    /** `complete` when the body was retrieved, `metadata-only` when the fetch did not land. */
    bodyStatus: text('body_status').notNull().default('complete'),
    receivedAt: timestamp('received_at').notNull().defaultNow(),
    attachments: jsonb('attachments').$type<AthenaMailAttachmentMeta[]>().notNull().default([]),
    /** This message's entry in the universal inbox stream. */
    streamEventId: text('stream_event_id'),
    /** The Athena conversation the message was delivered into. */
    sessionId: text('session_id').references(() => agentSession.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('athena_inbound_message_owner_provider_uq').on(t.ownerUserId, t.providerMessageId),
    index('athena_inbound_message_owner_received_idx').on(t.ownerUserId, t.receivedAt),
    index('athena_inbound_message_org_idx').on(t.organizationId),
    check(
      'athena_inbound_message_body_status_check',
      sql`${t.bodyStatus} in ('complete', 'metadata-only')`,
    ),
    check('athena_inbound_message_provider_check', sql`${t.provider} in ('resend', 'fixture')`),
  ],
);

/** Immutable outgoing messages with leased delivery and bounded provider retries. */
export const athenaMailOutbox = pgTable(
  'athena_mail_outbox',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    mailboxId: text('mailbox_id')
      .notNull()
      .references(() => athenaMailbox.id, { onDelete: 'cascade' }),
    inboundMessageId: text('inbound_message_id').references(() => athenaInboundMessage.id, {
      onDelete: 'cascade',
    }),
    sessionId: text('session_id').references(() => agentSession.id, { onDelete: 'set null' }),
    channelRevision: integer('channel_revision').notNull(),
    toAddress: text('to_address').notNull(),
    subject: text('subject').notNull(),
    bodyText: text('body_text').notNull(),
    attachments: jsonb('attachments').$type<AthenaMailAttachmentSnapshot[]>().notNull().default([]),
    headers: jsonb('headers').$type<Record<string, string>>().notNull().default({}),
    responseStage: text('response_stage').notNull().default('settled'),
    externalRecipient: boolean('external_recipient').notNull().default(false),
    status: text('status').notNull().default('queued'),
    providerMessageId: text('provider_message_id'),
    errorCode: text('error_code'),
    attempts: integer('attempts').notNull().default(0),
    leaseToken: text('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at'),
    availableAt: timestamp('available_at').notNull().defaultNow(),
    firstAttemptAt: timestamp('first_attempt_at'),
    sentAt: timestamp('sent_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('athena_mail_outbox_inbound_uq').on(t.inboundMessageId, t.responseStage),
    index('athena_mail_outbox_status_idx').on(t.status, t.availableAt),
  ],
);
/** Signed provider receipts survive callbacks racing ahead of send acknowledgment. */
export const athenaMailProviderEvent = pgTable('athena_mail_provider_event', {
  id: text('id').primaryKey(),
  providerMessageId: text('provider_message_id').notNull(),
  kind: text('kind').notNull(),
  receivedAt: timestamp('received_at').notNull().defaultNow(),
});

/** Durable blob ownership survives message/account cascades for recoverable private cleanup. */
export const athenaMailBlob = pgTable('athena_mail_blob', {
  key: text('key').primaryKey(),
  ownerUserId: text('owner_user_id').notNull(),
  messageId: text('message_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
