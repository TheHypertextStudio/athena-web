import { z } from 'zod';
import { WorkResourceSubjectType, MAX_ATTACHMENT_BYTES } from '@docket/work/attachment-contract';
import { OrganizationId } from '@docket/identity-access/ids';
import { LibraryKind, LibrarySummary } from './library';

/** Inline and legacy multipart limit; storage-side copies use the larger resumable file ceiling. */
export const MAX_RESOURCE_BYTES = MAX_ATTACHMENT_BYTES;

/** Safe display filename; storage paths never use this value. */
export const ResourceFileName = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[^/\\]+$/)
  .refine((value) => value !== '.' && value !== '..' && !/\p{Cc}/u.test(value));
/** A MIME essence without header controls or user-supplied parameters. */
export const ResourceMimeType = z
  .string()
  .max(255)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*$/);
/** Shared destination and durable retry identity. */
export const ResourceWriteTarget = z.object({
  orgId: OrganizationId,
  subjectType: WorkResourceSubjectType,
  subjectId: z.string().min(1),
  requestId: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .describe('Stable unique request ID. Reuse only for an identical retry.'),
  title: z.string().trim().min(1).max(500).optional(),
});
/** Bounded JSON transport for a file supplied by an MCP host. */
export const UploadResourceInput = ResourceWriteTarget.extend({
  fileName: ResourceFileName,
  mimeType: ResourceMimeType.default('application/octet-stream'),
  contentBase64: z
    .string()
    .min(4)
    .max(4 * Math.ceil(MAX_RESOURCE_BYTES / 3))
    .describe('Canonical padded base64, 1–4194304 decoded bytes. No data URL or local path.'),
});
/** A readable same-workspace Library source, never an arbitrary URL to fetch. */
export const AttachResourceInput = ResourceWriteTarget.extend({
  resource: z.object({ kind: LibraryKind, id: z.string().min(1) }),
});
/** Safe acknowledgement that distinguishes an independent file copy from a linked reference. */
export const ResourceWriteOutput = z.object({
  resource: LibrarySummary,
  replayed: z.boolean(),
  disposition: z.enum(['uploaded', 'copied', 'linked']),
  source: z.object({ orgId: OrganizationId, kind: LibraryKind, id: z.string() }).optional(),
});
