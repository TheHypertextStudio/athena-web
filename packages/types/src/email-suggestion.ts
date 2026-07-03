/**
 * `@docket/types` — EmailSuggestion slice DTOs.
 *
 * @remarks
 * An email suggestion is a *proposed* synthesized task drawn from an email thread — never a
 * task until accepted. Accepting materializes a task (and an `email` attachment back to the
 * thread); dismissing discards it. See `docs/engineering/specs/email-to-task.md` §2/§6.
 */
import { z } from 'zod';

import { Priority } from './capability';
import { EmailSuggestionId, IntegrationId, OrganizationId, TaskId } from './primitives';

/** Lifecycle status of an email suggestion. */
export const EmailSuggestionStatus = z.enum(['pending', 'accepted', 'dismissed']);
/** Email-suggestion status value. */
export type EmailSuggestionStatus = z.infer<typeof EmailSuggestionStatus>;

/** A snapshot of the source email, stored for rendering the suggestion without a fetch. */
export const EmailSuggestionMeta = z
  .object({
    sender: z.string(),
    subject: z.string(),
    snippet: z.string(),
    receivedAt: z.string(),
    /** RFC 5322 Message-ID of the thread's latest message (cross-provider identity). */
    rfc822MessageId: z.string(),
    /** Canonical open-in-provider URL captured at ingest time (never fabricated later). */
    externalUrl: z.string(),
  })
  .partial()
  .meta({ id: 'EmailSuggestionMeta', description: 'Snapshot of the source email.' });
/** Email-snapshot value. */
export type EmailSuggestionMeta = z.infer<typeof EmailSuggestionMeta>;

/** One message of a fetched source-email thread (render-ready; bodies never persisted). */
export const EmailThreadMessageOut = z
  .object({
    id: z.string().describe("The message's external id."),
    from: z.string().describe('The sender (display form).'),
    to: z.array(z.string()).describe('Recipients.'),
    subject: z.string().describe('Subject line.'),
    snippet: z.string().describe('Short preview snippet.'),
    sentAt: z.string().describe('When the message was sent (RFC3339).'),
    rfc822MessageId: z
      .string()
      .nullable()
      .describe('RFC 5322 Message-ID, when the provider surfaces it.'),
    bodyHtml: z
      .string()
      .nullable()
      .describe('The rendered body when the provider returned one — served live, never stored.'),
  })
  .meta({ id: 'EmailThreadMessageOut', description: 'One message of a source-email thread.' });
/** Email-thread-message value. */
export type EmailThreadMessageOut = z.infer<typeof EmailThreadMessageOut>;

/**
 * A suggestion's source-email thread, fetched on demand for the triage preview.
 *
 * @remarks
 * Served straight from the mail provider via the connector's `fetchThread` — nothing here
 * is persisted (the stored snapshot is {@link EmailSuggestionMeta}).
 */
export const EmailThreadOut = z
  .object({
    threadId: z.string().describe('The provider-native thread id.'),
    subject: z.string().describe('The thread subject.'),
    externalUrl: z.string().describe('Canonical open-in-provider URL.'),
    messages: z.array(EmailThreadMessageOut).describe('The messages, oldest first.'),
  })
  .meta({ id: 'EmailThreadOut', description: "A suggestion's source-email thread." });
/** Email-thread value. */
export type EmailThreadOut = z.infer<typeof EmailThreadOut>;

/** Full email-suggestion representation returned by reads. */
export const EmailSuggestionOut = z
  .object({
    id: EmailSuggestionId,
    organizationId: OrganizationId,
    integrationId: IntegrationId,
    externalThreadId: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    dueDate: z.string().nullable(),
    priority: Priority,
    suggestedProjectId: z.string().nullable(),
    suggestedProgramId: z.string().nullable(),
    confidence: z.number().int().nullable(),
    status: EmailSuggestionStatus,
    emailMeta: EmailSuggestionMeta.nullable(),
    createdTaskId: TaskId.nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'EmailSuggestionOut', description: 'An Athena-synthesized email task suggestion.' });
/** Email-suggestion representation value. */
export type EmailSuggestionOut = z.infer<typeof EmailSuggestionOut>;

/**
 * Body for accepting a suggestion — optional last-mile overrides applied at materialization.
 *
 * @remarks
 * The user can correct the synthesized draft before it becomes a task; omitted fields keep
 * the suggested values.
 */
export const SuggestionAcceptBody = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    priority: Priority.optional(),
    dueDate: z.string().optional(),
  })
  .meta({ id: 'SuggestionAcceptBody', description: 'Optional overrides applied when accepting.' });
/** Accept-body value. */
export type SuggestionAcceptBody = z.infer<typeof SuggestionAcceptBody>;

/** Acknowledgement returned when a suggestion is dismissed. */
export const SuggestionDismissed = z
  .object({
    id: EmailSuggestionId,
    status: z.literal('dismissed'),
  })
  .meta({ id: 'SuggestionDismissed', description: 'A dismissed-suggestion acknowledgement.' });
/** Dismissal acknowledgement value. */
export type SuggestionDismissed = z.infer<typeof SuggestionDismissed>;
