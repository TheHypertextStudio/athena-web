/**
 * `@docket/types` — Attachment slice DTOs.
 *
 * @remarks
 * An attachment is a typed reference from a subject (a task, for now) to an external or
 * stored resource. `url` attachments are dumb pointers (a pasted link + fetched
 * title/favicon); `email` attachments are integration-backed pointers (the content stays in
 * Gmail); `calendar_event` attachments point at cached first-party Google Calendar context.
 * The conceptual model lives in `docs/engineering/specs/email-to-task.md`.
 */
import { z } from 'zod';

import { AttachmentId, OrganizationId } from './primitives';

/** The polymorphic subject kinds an Attachment can attach to (only `task` ships in v1). */
export const AttachmentSubjectType = z.enum(['task']);
/** Attachment subject-type value. */
export type AttachmentSubjectType = z.infer<typeof AttachmentSubjectType>;

/** The kind of resource an Attachment references. */
export const AttachmentKind = z.enum(['email', 'url', 'calendar_event']);
/** Attachment kind value. */
export type AttachmentKind = z.infer<typeof AttachmentKind>;

/**
 * Body for creating an Attachment on a task. The subject (`task` + the task id) comes from
 * the route, never the body.
 *
 * @remarks
 * A `url` attachment requires `url`; an `email` attachment requires both `sourceIntegrationId`
 * and `externalId` (the Gmail thread id); a `calendar_event` attachment requires the external
 * Google event id, with first-party calendar context stored in metadata.
 */
export const AttachmentCreate = z
  .object({
    kind: AttachmentKind.describe(
      "Resource kind: 'url' (a dumb link pointer), 'email' (an integration-backed Gmail-thread pointer), or 'calendar_event' (a first-party Google Calendar event pointer). Determines which other fields are required.",
    ),
    title: z
      .string()
      .min(1)
      .describe(
        'Human label for the attachment (e.g. the page title or email subject). Required, non-empty.',
      ),
    url: z
      .url()
      .optional()
      .describe(
        'The link target. Required when `kind` is `url`; ignored for `email`. Must be a valid URL.',
      ),
    sourceIntegrationId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Id of the integration backing an `email` attachment. Required (with `externalId`) when `kind` is `email`.',
      ),
    externalId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The external resource id — for `email`, the Gmail thread id; for `calendar_event`, the Google event id.',
      ),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Optional free-form JSON bag of kind-specific extras (e.g. fetched favicon, sender, snippet).',
      ),
  })
  .refine((v) => v.kind !== 'url' || v.url !== undefined, {
    path: ['url'],
    message: 'A url attachment requires a url',
  })
  .refine(
    (v) =>
      v.kind !== 'email' || (v.sourceIntegrationId !== undefined && v.externalId !== undefined),
    {
      path: ['externalId'],
      message: 'An email attachment requires sourceIntegrationId and externalId',
    },
  )
  .refine((v) => v.kind !== 'calendar_event' || v.externalId !== undefined, {
    path: ['externalId'],
    message: 'A calendar event attachment requires externalId',
  })
  .meta({ id: 'AttachmentCreate', description: 'Attach a resource to a task.' });
/** Validated attachment-create body. */
export type AttachmentCreate = z.infer<typeof AttachmentCreate>;

/** Full attachment representation returned by reads. */
export const AttachmentOut = z
  .object({
    id: AttachmentId.describe('Opaque attachment id.'),
    organizationId: OrganizationId.describe('Owning org id (the tenant key).'),
    subjectType: AttachmentSubjectType.describe(
      "Kind of subject the attachment hangs off (only 'task' in v1).",
    ),
    subjectId: z.string().describe('Id of the subject (the host task) the attachment belongs to.'),
    kind: AttachmentKind.describe("Resource kind: 'url', 'email', or 'calendar_event'."),
    title: z.string().describe('Human label for the attachment.'),
    url: z
      .string()
      .nullable()
      .describe('Link target for a `url` attachment; null for integration-backed kinds.'),
    sourceIntegrationId: z
      .string()
      .nullable()
      .describe('Backing integration id for an `email` attachment; null for other kinds.'),
    externalId: z
      .string()
      .nullable()
      .describe('External resource id (e.g. Gmail thread id or Google event id); null for `url`.'),
    metadata: z
      .record(z.string(), z.unknown())
      .nullable()
      .describe('Free-form JSON bag of kind-specific extras; null when none.'),
    createdAt: z.string().describe('Creation timestamp (ISO 8601); attachments list oldest-first.'),
  })
  .meta({ id: 'AttachmentOut', description: 'An attachment on a subject.' });
/** Attachment representation value. */
export type AttachmentOut = z.infer<typeof AttachmentOut>;

/** Acknowledgement returned when an Attachment is removed. */
export const AttachmentRemoved = z
  .object({
    id: AttachmentId.describe('Id of the removed attachment.'),
    removed: z.literal(true).describe('Always `true`; confirms the attachment was hard-deleted.'),
  })
  .meta({ id: 'AttachmentRemoved', description: 'A removed-attachment acknowledgement.' });
/** Removal acknowledgement value. */
export type AttachmentRemoved = z.infer<typeof AttachmentRemoved>;
