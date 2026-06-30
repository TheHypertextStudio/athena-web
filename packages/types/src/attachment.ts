/**
 * `@docket/types` — Attachment slice DTOs.
 *
 * @remarks
 * An attachment is a typed reference from a subject (a task, for now) to an external or
 * stored resource. `url` attachments are dumb pointers (a pasted link + fetched
 * title/favicon); `email` attachments are integration-backed pointers (the content stays in
 * Gmail). The conceptual model lives in `docs/engineering/specs/email-to-task.md`.
 */
import { z } from 'zod';

import { AttachmentId, OrganizationId } from './primitives';

/** The polymorphic subject kinds an Attachment can attach to (only `task` ships in v1). */
export const AttachmentSubjectType = z.enum(['task']);
/** Attachment subject-type value. */
export type AttachmentSubjectType = z.infer<typeof AttachmentSubjectType>;

/** The kind of resource an Attachment references. */
export const AttachmentKind = z.enum(['email', 'url']);
/** Attachment kind value. */
export type AttachmentKind = z.infer<typeof AttachmentKind>;

/**
 * Body for creating an Attachment on a task. The subject (`task` + the task id) comes from
 * the route, never the body.
 *
 * @remarks
 * A `url` attachment requires `url`; an `email` attachment requires both `sourceIntegrationId`
 * and `externalId` (the Gmail thread id). The refinement keeps malformed kinds out at the
 * edge so handlers never see a half-specified attachment.
 */
export const AttachmentCreate = z
  .object({
    kind: AttachmentKind,
    title: z.string().min(1),
    url: z.url().optional(),
    sourceIntegrationId: z.string().min(1).optional(),
    externalId: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
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
  .meta({ id: 'AttachmentCreate', description: 'Attach a resource to a task.' });
/** Validated attachment-create body. */
export type AttachmentCreate = z.infer<typeof AttachmentCreate>;

/** Full attachment representation returned by reads. */
export const AttachmentOut = z
  .object({
    id: AttachmentId,
    organizationId: OrganizationId,
    subjectType: AttachmentSubjectType,
    subjectId: z.string(),
    kind: AttachmentKind,
    title: z.string(),
    url: z.string().nullable(),
    sourceIntegrationId: z.string().nullable(),
    externalId: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'AttachmentOut', description: 'An attachment on a subject.' });
/** Attachment representation value. */
export type AttachmentOut = z.infer<typeof AttachmentOut>;

/** Acknowledgement returned when an Attachment is removed. */
export const AttachmentRemoved = z
  .object({
    id: AttachmentId,
    removed: z.literal(true),
  })
  .meta({ id: 'AttachmentRemoved', description: 'A removed-attachment acknowledgement.' });
/** Removal acknowledgement value. */
export type AttachmentRemoved = z.infer<typeof AttachmentRemoved>;
