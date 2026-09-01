/**
 * `domain packages` — Athena's inbox: the shared **context-object** contract, and the mail slice
 * that implements it.
 *
 * @remarks
 * The author's requirement for Athena-received mail was that it get "a data representation that
 * treats them like discrete context objects that can be attached to stuff, not just emails". Two
 * schemas encode that here, and the order matters:
 *
 * {@link ContextObjectOut} is the general shape — a stable id, a title, its content, where it came
 * from, and when. Nothing in it is email-shaped. A surface that renders a context object, a picker
 * that lists them, or an agent that reads one needs no knowledge of mail, so a second kind of
 * context object (a captured document, a call transcript) can appear in exactly the same places
 * by returning this shape.
 *
 * {@link AthenaMailMessageOut} extends it with the envelope a *message* additionally has — sender,
 * recipient address, attachments. Extending rather than replacing is what keeps the general
 * contract honest: the email fields are extra detail on a context object, not the thing itself.
 *
 * Attachment to work is not modelled here at all, deliberately. A context object attaches through
 * the ordinary polymorphic {@link AttachmentOut} table like every other attachable resource, so
 * there is no mail-specific join and no mail-only path to reach one from a task or a project.
 */
import { z } from 'zod';

import { AttachmentSubjectType } from '@docket/work/attachment-contract';
import { OrganizationId } from '@docket/identity-access/ids';

/**
 * The kinds of discrete context object Docket holds.
 *
 * @remarks
 * A closed enum with one member today. It exists as an enum rather than a literal because it is
 * the discriminator every generic context surface switches on, and adding the second kind should
 * be a compile-checked change rather than a string search.
 */
export const ContextObjectKind = z.enum(['athena_email']);
/** Context-object kind value. */
export type ContextObjectKind = z.infer<typeof ContextObjectKind>;

/**
 * Whether a context object's content was actually captured.
 *
 * @remarks
 * `metadata-only` is not an error state — the object exists and is attachable — it is the honest
 * statement that the body could not be retrieved. Without it, "we could not fetch the content"
 * and "there was no content" would render identically, and only one of those is true.
 */
export const ContextObjectContentStatus = z.enum(['complete', 'metadata-only']);
/** Context-object content-status value. */
export type ContextObjectContentStatus = z.infer<typeof ContextObjectContentStatus>;

/** Where a context object came from — its provenance, carried on every one of them. */
export const ContextObjectSource = z
  .object({
    system: z
      .string()
      .describe("The system that produced it — 'docket' for anything Docket itself received."),
    provider: z
      .string()
      .describe("The adapter that received it (e.g. 'resend'); recorded for auditability."),
    reference: z
      .string()
      .describe("The producing system's own id for the object — the redelivery idempotency key."),
    label: z
      .string()
      .describe('A short human attribution, e.g. the sender address for a received message.'),
  })
  .meta({ id: 'ContextObjectSource', description: 'Provenance of a context object.' });
/** Context-object provenance value. */
export type ContextObjectSource = z.infer<typeof ContextObjectSource>;

/** The shared shape every discrete, attachable context object exposes. */
export const ContextObjectOut = z
  .object({
    id: z.string().describe('Stable opaque id — the value attachments reference.'),
    kind: ContextObjectKind.describe('Which kind of context object this is.'),
    organizationId: OrganizationId.describe('Workspace the object is filed in.'),
    title: z.string().describe('Human title (a received message uses its subject).'),
    snippet: z
      .string()
      .nullable()
      .describe('Short preview of the content; null when there is none.'),
    content: z.string().nullable().describe('Plain-text content; null when it was not captured.'),
    contentStatus: ContextObjectContentStatus.describe('Whether the content was captured at all.'),
    source: ContextObjectSource.describe('Where the object came from.'),
    occurredAt: z
      .string()
      .describe('ISO-8601 instant the object came into being (a message: when it was received).'),
    createdAt: z.string().describe('ISO-8601 instant Docket stored it.'),
    permalink: z.string().nullable().describe('In-app link to the object; null when it has none.'),
  })
  .meta({
    id: 'ContextObjectOut',
    description: 'A discrete context object that can be attached to Docket work.',
  });
/** Context-object representation value. */
export type ContextObjectOut = z.infer<typeof ContextObjectOut>;

/** One file that arrived with a received message (metadata only). */
export const AthenaMailAttachmentOut = z
  .object({
    id: z.string().describe("The receiving provider's id for the file."),
    filename: z.string().describe('Filename as the sender supplied it.'),
    contentType: z.string().nullable().describe('Declared MIME type, when the provider gave one.'),
  })
  .meta({ id: 'AthenaMailAttachmentOut', description: 'A file attached to a received message.' });
/** Received-message attachment value. */
export type AthenaMailAttachmentOut = z.infer<typeof AthenaMailAttachmentOut>;

/** A message received at an Athena inbox address — a context object plus its envelope. */
export const AthenaMailMessageOut = ContextObjectOut.extend({
  fromAddress: z.string().describe("The sender's address."),
  fromName: z.string().nullable().describe("The sender's display name, when the header had one."),
  toAddress: z.string().describe('The Athena address the message was accepted for.'),
  bodyHtml: z.string().nullable().describe('HTML body, when the message had one.'),
  attachments: z.array(AthenaMailAttachmentOut).describe('Files that arrived with the message.'),
  streamEventId: z
    .string()
    .nullable()
    .describe('Id of this message’s entry in the universal inbox stream; null until fan-out.'),
  attachedCount: z
    .number()
    .int()
    .describe('How many Docket entities this message is currently attached to.'),
}).meta({
  id: 'AthenaMailMessageOut',
  description: 'A message Athena received natively, as an attachable context object.',
});
/** Received-message representation value. */
export type AthenaMailMessageOut = z.infer<typeof AthenaMailMessageOut>;

/**
 * The caller's Athena inbox address.
 *
 * @remarks
 * `address` is `null` when no receiving domain is configured, and that is reported rather than
 * papered over: printing an address whose domain has no MX records would invite people to send
 * mail that silently bounces. The surface says the inbox is not ready instead.
 */
export const AthenaMailboxOut = z
  .object({
    address: z
      .string()
      .nullable()
      .describe('The full inbox address, or null when no receiving domain is configured.'),
    host: z
      .string()
      .nullable()
      .describe('The configured receiving domain, or null when there is none.'),
    configured: z
      .boolean()
      .describe('Whether Athena can receive mail right now (a receiving domain is configured).'),
  })
  .meta({ id: 'AthenaMailboxOut', description: "The caller's Athena inbox address." });
/** Athena mailbox value. */
export type AthenaMailboxOut = z.infer<typeof AthenaMailboxOut>;

/** Body for attaching a received message to a Docket entity. */
export const AthenaMailAttachBody = z
  .object({
    subjectType: AttachmentSubjectType.describe('Which kind of entity to attach the message to.'),
    subjectId: z.string().min(1).describe('Id of the entity to attach the message to.'),
    organizationId: OrganizationId.describe('Workspace the target entity belongs to.'),
  })
  .meta({
    id: 'AthenaMailAttachBody',
    description: 'Attach a received message to a task, project, or initiative.',
  });
/** Attach-request value. */
export type AthenaMailAttachBody = z.infer<typeof AthenaMailAttachBody>;

/** One place a received message is currently attached. */
export const AthenaMailAttachmentTargetOut = z
  .object({
    attachmentId: z.string().describe('Id of the attachment row linking message to entity.'),
    subjectType: AttachmentSubjectType.describe('Kind of entity the message is attached to.'),
    subjectId: z.string().describe('Id of that entity.'),
    subjectTitle: z.string().describe('That entity’s current title.'),
    organizationId: OrganizationId.describe('Workspace the entity belongs to.'),
    createdAt: z.string().describe('ISO-8601 instant the message was attached.'),
  })
  .meta({
    id: 'AthenaMailAttachmentTargetOut',
    description: 'A Docket entity a received message is attached to.',
  });
/** Attachment-target value. */
export type AthenaMailAttachmentTargetOut = z.infer<typeof AthenaMailAttachmentTargetOut>;
