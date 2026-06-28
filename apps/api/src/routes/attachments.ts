/**
 * Attachment routes for file uploads.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import { and, eq, isNull } from 'drizzle-orm';
import {
  AttachmentIdParamSchema,
  EntityAttachmentParamSchema,
  SignedUrlQuerySchema,
  UploadResponseSchema,
  AttachmentInfoResponseSchema,
  SignedUrlResponseSchema,
  EntityAttachmentsResponseSchema,
} from '@athena/types/openapi/attachments';
import {
  NotFoundErrorSchema,
  UnauthorizedErrorSchema,
  ErrorResponseSchema,
} from '@athena/types/openapi/common';
import { db } from '../db/index.js';
import { attachments } from '../db/schema/index.js';
import { getStorageService } from '../services/storage/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import { parseUploadFormData } from './attachments/helpers.js';
import { toAttachment } from './attachments/serializers.js';

const app = createOpenAPIApp();

// Require authentication for all attachment routes
app.use('*', requireAuth);

const ERROR_NO_FILE_PROVIDED = 'No file provided';
const ERROR_ATTACHMENT_NOT_FOUND = 'Attachment not found';
const ERROR_UPLOAD_FAILED = 'Upload failed';
const ERROR_DOWNLOAD_FAILED = 'Download failed';
const ERROR_SIGNED_URL_FAILED = 'Failed to generate URL';
const NOT_FOUND_ERROR = 'Not found' as const;

// =============================================================================
// Upload Attachment
// =============================================================================

const uploadAttachment = createRoute({
  method: 'post',
  path: '/upload',
  tags: ['Attachments'],
  summary: 'Upload file',
  description: 'Upload a file attachment.',
  responses: {
    200: {
      description: 'File uploaded successfully',
      content: {
        'application/json': {
          schema: UploadResponseSchema,
        },
      },
    },
    400: {
      description: 'Upload failed',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get Attachment Info
// =============================================================================

const getAttachmentInfo = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Attachments'],
  summary: 'Get attachment info',
  description: 'Get attachment information.',
  request: {
    params: AttachmentIdParamSchema,
  },
  responses: {
    200: {
      description: 'Attachment info retrieved successfully',
      content: {
        'application/json': {
          schema: AttachmentInfoResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Attachment not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Download Attachment
// =============================================================================

const downloadAttachment = createRoute({
  method: 'get',
  path: '/{id}/download',
  tags: ['Attachments'],
  summary: 'Download file',
  description: 'Download an attachment.',
  request: {
    params: AttachmentIdParamSchema,
  },
  responses: {
    200: {
      description: 'File download',
      content: {
        '*/*': {
          schema: {
            type: 'string',
            format: 'binary',
          },
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Attachment not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get Signed URL
// =============================================================================

const getSignedUrl = createRoute({
  method: 'get',
  path: '/{id}/signed-url',
  tags: ['Attachments'],
  summary: 'Get signed URL',
  description: 'Get a signed URL for temporary access.',
  request: {
    params: AttachmentIdParamSchema,
    query: SignedUrlQuerySchema,
  },
  responses: {
    200: {
      description: 'Signed URL generated successfully',
      content: {
        'application/json': {
          schema: SignedUrlResponseSchema,
        },
      },
    },
    400: {
      description: 'Failed to generate URL',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Attachment
// =============================================================================

const deleteAttachment = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Attachments'],
  summary: 'Delete attachment',
  description: 'Delete an attachment.',
  request: {
    params: AttachmentIdParamSchema,
  },
  responses: {
    204: {
      description: 'Attachment deleted successfully',
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Attachment not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// List Entity Attachments
// =============================================================================

const listEntityAttachments = createRoute({
  method: 'get',
  path: '/entity/{type}/{entityId}',
  tags: ['Attachments'],
  summary: 'List entity attachments',
  description: 'List attachments for an entity.',
  request: {
    params: EntityAttachmentParamSchema,
  },
  responses: {
    200: {
      description: 'Attachments retrieved successfully',
      content: {
        'application/json': {
          schema: EntityAttachmentsResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid entity type',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

/**
 * POST /attachments/upload
 * Upload a file.
 */
app.openapi(uploadAttachment, async (c) => {
  const userId = getUserId(c);
  const formData = await c.req.formData();

  const parsed = parseUploadFormData(formData);
  if (!parsed.success) {
    return c.json(
      {
        error: parsed.error === 'missing_file' ? ERROR_NO_FILE_PROVIDED : ERROR_UPLOAD_FAILED,
      },
      400,
    );
  }

  const { file, entityType, entityId, isPublic } = parsed.data;

  try {
    const service = getStorageService();
    const result = await service.upload(file, {
      userId,
      filename: file.name,
      mimeType: file.type,
      entityType,
      entityId,
      isPublic,
    });

    return c.json(
      {
        data: {
          id: result.id,
          url: result.publicUrl ?? null,
          originalFilename: file.name,
          mimeType: file.type,
          size: result.size,
        },
      },
      200,
    );
  } catch {
    return c.json(
      {
        error: ERROR_UPLOAD_FAILED,
      },
      400,
    );
  }
});

/**
 * GET /attachments/:id
 * Get attachment info.
 */
app.openapi(getAttachmentInfo, async (c) => {
  const userId = getUserId(c);
  const { id: attachmentId } = c.req.valid('param');

  const info = await db.query.attachments.findFirst({
    where: and(
      eq(attachments.id, attachmentId),
      eq(attachments.userId, userId),
      isNull(attachments.deletedAt),
    ),
  });

  if (!info) {
    return c.json({ error: NOT_FOUND_ERROR, message: ERROR_ATTACHMENT_NOT_FOUND }, 404);
  }

  return c.json({ data: toAttachment(info) }, 200);
});

/**
 * GET /attachments/:id/download
 * Download a file.
 */
app.openapi(downloadAttachment, async (c) => {
  const userId = getUserId(c);
  const { id: attachmentId } = c.req.valid('param');

  try {
    const service = getStorageService();
    const { stream, info } = await service.download(attachmentId, userId);

    return new Response(stream, {
      headers: {
        'Content-Type': info.mimeType,
        'Content-Disposition': `attachment; filename="${info.originalFilename}"`,
        'Content-Length': String(info.size),
      },
    });
  } catch {
    return c.json(
      {
        error: NOT_FOUND_ERROR,
        message: ERROR_DOWNLOAD_FAILED,
      },
      404,
    );
  }
});

/**
 * GET /attachments/:id/signed-url
 * Get a signed URL for temporary access.
 */
app.openapi(getSignedUrl, async (c) => {
  const userId = getUserId(c);
  const { id: attachmentId } = c.req.valid('param');
  const { expiresIn, contentDisposition } = c.req.valid('query');

  try {
    const service = getStorageService();
    const url = await service.getSignedUrl(attachmentId, userId, {
      expiresIn,
      contentDisposition,
    });

    return c.json({ data: { url, expiresIn } }, 200);
  } catch {
    return c.json(
      {
        error: ERROR_SIGNED_URL_FAILED,
      },
      400,
    );
  }
});

/**
 * DELETE /attachments/:id
 * Delete an attachment.
 */
app.openapi(deleteAttachment, async (c) => {
  const userId = getUserId(c);
  const { id: attachmentId } = c.req.valid('param');

  const service = getStorageService();
  const deleted = await service.delete(attachmentId, userId);

  if (!deleted) {
    return c.json({ error: NOT_FOUND_ERROR, message: ERROR_ATTACHMENT_NOT_FOUND }, 404);
  }

  return c.body(null, 204);
});

/**
 * GET /attachments/entity/:type/:id
 * List attachments for an entity.
 */
app.openapi(listEntityAttachments, async (c) => {
  const userId = getUserId(c);
  const { type: entityType, entityId } = c.req.valid('param');

  const results = await db.query.attachments.findMany({
    where: and(
      eq(attachments.userId, userId),
      eq(attachments.entityType, entityType),
      eq(attachments.entityId, entityId),
      isNull(attachments.deletedAt),
    ),
  });

  return c.json({ data: results.map(toAttachment) }, 200);
});

export default app;
