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
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { genId } from '../id';
import { agentSession } from './agents';
import { user } from './auth';
import { auditColumns, organization } from './identity';

/** A file that arrived with a message: metadata only, bytes stay at the provider. */
export interface AthenaMailAttachmentMeta {
  /** The provider's id for the attachment. */
  id: string;
  /** Filename as the sender's client supplied it. */
  filename: string;
  /** Declared MIME type, when the provider reported one. */
  contentType: string | null;
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
