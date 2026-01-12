/**
 * Attachments OpenAPI schemas.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema, successResponseSchema } from './common.js';

// =============================================================================
// Enums
// =============================================================================

export const AttachmentEntityTypeSchema = z.enum(['task', 'project', 'event']).openapi({
  description: 'Entity type for attachment',
  example: 'task',
});

export const ContentDispositionSchema = z.enum(['inline', 'attachment']).openapi({
  description: 'Content disposition for download',
  example: 'attachment',
});

// =============================================================================
// Core Attachment Schemas
// =============================================================================

export const AttachmentSchema = z
  .object({
    id: z.string().openapi({ description: 'Attachment ID' }),
    userId: z.uuid().openapi({ description: 'Owner user ID' }),
    originalFilename: z.string().openapi({ description: 'Original filename' }),
    mimeType: z.string().openapi({ description: 'MIME type' }),
    size: z.number().int().openapi({ description: 'File size in bytes' }),
    entityType: AttachmentEntityTypeSchema.nullable().openapi({
      description: 'Associated entity type',
    }),
    entityId: z.string().nullable().openapi({ description: 'Associated entity ID' }),
    isPublic: z.boolean().openapi({ description: 'Public accessibility' }),
    url: z.string().nullable().openapi({ description: 'Public URL if available' }),
    createdAt: TimestampSchema.openapi({ description: 'Upload timestamp' }),
  })
  .openapi('Attachment');

export const UploadResultSchema = z
  .object({
    id: z.string().openapi({ description: 'Attachment ID' }),
    url: z.string().nullable().openapi({ description: 'Public URL if available' }),
    originalFilename: z.string().openapi({ description: 'Original filename' }),
    mimeType: z.string().openapi({ description: 'MIME type' }),
    size: z.number().int().openapi({ description: 'File size in bytes' }),
  })
  .openapi('UploadResult');

export const SignedUrlResultSchema = z
  .object({
    url: z.string().openapi({ description: 'Signed URL' }),
    expiresIn: z.number().int().openapi({ description: 'Expiration in seconds' }),
  })
  .openapi('SignedUrlResult');

// =============================================================================
// Path Parameters
// =============================================================================

export const AttachmentIdParamSchema = z
  .object({
    id: z.string().openapi({
      description: 'Attachment ID',
      param: { name: 'id', in: 'path' },
    }),
  })
  .openapi('AttachmentIdParam');

export const EntityAttachmentParamSchema = z
  .object({
    type: AttachmentEntityTypeSchema.openapi({
      param: { name: 'type', in: 'path' },
    }),
    entityId: z.string().openapi({
      description: 'Entity ID',
      param: { name: 'entityId', in: 'path' },
    }),
  })
  .openapi('EntityAttachmentParam');

// =============================================================================
// Query Parameters
// =============================================================================

export const SignedUrlQuerySchema = z
  .object({
    expiresIn: z.coerce
      .number()
      .int()
      .min(60)
      .max(86400)
      .default(3600)
      .openapi({
        description: 'Expiration time in seconds (60-86400)',
        param: { name: 'expiresIn', in: 'query' },
      }),
    contentDisposition: ContentDispositionSchema.optional().openapi({
      description: 'Content disposition',
      param: { name: 'contentDisposition', in: 'query' },
    }),
  })
  .openapi('SignedUrlQuery');

// =============================================================================
// Response Schemas
// =============================================================================

export const UploadResponseSchema = successResponseSchema(
  UploadResultSchema,
  'Upload result',
).openapi('UploadResponse');

export const AttachmentInfoResponseSchema = successResponseSchema(
  AttachmentSchema,
  'Attachment info',
).openapi('AttachmentInfoResponse');

export const SignedUrlResponseSchema = successResponseSchema(
  SignedUrlResultSchema,
  'Signed URL',
).openapi('SignedUrlResponse');

export const EntityAttachmentsResponseSchema = successResponseSchema(
  z.array(AttachmentSchema),
  'Entity attachments',
).openapi('EntityAttachmentsResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type AttachmentEntityType = z.infer<typeof AttachmentEntityTypeSchema>;
export type ContentDisposition = z.infer<typeof ContentDispositionSchema>;
export type Attachment = z.infer<typeof AttachmentSchema>;
export type UploadResult = z.infer<typeof UploadResultSchema>;
export type SignedUrlResult = z.infer<typeof SignedUrlResultSchema>;
