import { z } from 'zod';
import {
  DeliverableOut,
  MAX_UPLOAD_BYTES,
  WorkResourceSubjectType,
} from '@docket/work/attachment-contract';
import { ResourceFileName, ResourceMimeType } from './resource-write';

/** Publication destination; drafts remain private until a post atomically claims their IDs. */
export const UploadDestination = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('draft') }),
  z.object({
    kind: z.literal('work'),
    subjectType: WorkResourceSubjectType,
    subjectId: z.string().min(1),
  }),
]);
/** Immutable declaration of one resumable transfer with an explicit retry identity. */
export const UploadBegin = z.object({
  requestId: z.string().trim().min(1).max(128),
  fileName: ResourceFileName,
  mimeType: ResourceMimeType.default('application/octet-stream'),
  title: z.string().trim().min(1).max(500).optional(),
  byteSize: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
  crc32c: z
    .string()
    .regex(/^[A-Za-z0-9+/]{6}==$/u)
    .refine((value) => Buffer.from(value, 'base64').toString('base64') === value),
  destination: UploadDestination,
});
/** Resumable upload declaration. */
export type UploadBegin = z.infer<typeof UploadBegin>;
/** Safe receipt, plus a sensitive short-lived write capability while the transfer is pending. */
export const UploadSessionOut = z.object({
  id: z.string(),
  state: z.enum(['pending', 'completed', 'cancelled', 'cleaned']),
  offset: z.number().int().min(0),
  byteSize: z.number().int().min(1),
  chunkSize: z.number().int().min(1),
  expiresAt: z.iso.datetime(),
  uploadUrl: z.url().optional(),
  uploadToken: z.string().optional(),
  file: DeliverableOut.optional(),
});
/** Shared session response for REST, MCP and browser clients. */
export type UploadSessionOut = z.infer<typeof UploadSessionOut>;
