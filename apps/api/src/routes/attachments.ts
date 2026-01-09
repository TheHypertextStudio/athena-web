/**
 * Attachment routes for file uploads.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getStorageService } from '../services/storage/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';

const app = new Hono();

// Require authentication for all attachment routes
app.use('*', requireAuth);

const ATTACHMENT_CONTENT_DISPOSITION_VALUES = ['inline', 'attachment'] as const;
const SIGNED_URL_MIN_EXPIRES_SECONDS = 60;
const SIGNED_URL_MAX_EXPIRES_SECONDS = 86400;
const DEFAULT_SIGNED_URL_EXPIRES_SECONDS = 3600;

/**
 * POST /attachments/upload
 * Upload a file.
 */
app.post('/upload', async (c) => {
  const userId = getUserId(c);
  const formData = await c.req.formData();

  const file = formData.get('file');
  if (!file || !(file instanceof File)) {
    return c.json({ success: false, error: 'No file provided' }, 400);
  }

  const entityType = formData.get('entityType') as string | null;
  const entityId = formData.get('entityId') as string | null;
  const isPublic = formData.get('isPublic') === 'true';

  try {
    const service = getStorageService();
    const result = await service.upload(file, {
      userId,
      filename: file.name,
      mimeType: file.type,
      entityType: entityType as 'task' | 'project' | 'event' | undefined,
      entityId: entityId ?? undefined,
      isPublic,
    });

    return c.json({
      success: true,
      data: result,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed',
      },
      400,
    );
  }
});

/**
 * GET /attachments/:id
 * Get attachment info.
 */
app.get('/:id', async (c) => {
  const userId = getUserId(c);
  const attachmentId = c.req.param('id');

  const service = getStorageService();
  const info = await service.getInfo(attachmentId, userId);

  if (!info) {
    return c.json({ success: false, error: 'Attachment not found' }, 404);
  }

  return c.json({
    success: true,
    data: info,
  });
});

/**
 * GET /attachments/:id/download
 * Download a file.
 */
app.get('/:id/download', async (c) => {
  const userId = getUserId(c);
  const attachmentId = c.req.param('id');

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
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Download failed',
      },
      404,
    );
  }
});

/**
 * GET /attachments/:id/signed-url
 * Get a signed URL for temporary access.
 */
app.get(
  '/:id/signed-url',
  zValidator(
    'query',
    z.object({
      expiresIn: z.coerce
        .number()
        .min(SIGNED_URL_MIN_EXPIRES_SECONDS)
        .max(SIGNED_URL_MAX_EXPIRES_SECONDS)
        .optional()
        .default(DEFAULT_SIGNED_URL_EXPIRES_SECONDS),
      contentDisposition: z.enum(ATTACHMENT_CONTENT_DISPOSITION_VALUES).optional(),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const attachmentId = c.req.param('id');
    const { expiresIn, contentDisposition } = c.req.valid('query');

    try {
      const service = getStorageService();
      const url = await service.getSignedUrl(attachmentId, userId, {
        expiresIn,
        contentDisposition,
      });

      return c.json({
        success: true,
        data: { url, expiresIn },
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to generate URL',
        },
        400,
      );
    }
  },
);

/**
 * DELETE /attachments/:id
 * Delete an attachment.
 */
app.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const attachmentId = c.req.param('id');

  const service = getStorageService();
  const deleted = await service.delete(attachmentId, userId);

  if (!deleted) {
    return c.json({ success: false, error: 'Attachment not found' }, 404);
  }

  return c.body(null, 204);
});

/**
 * GET /attachments/entity/:type/:id
 * List attachments for an entity.
 */
app.get('/entity/:type/:entityId', async (c) => {
  const userId = getUserId(c);
  const entityType = c.req.param('type') as 'task' | 'project' | 'event';
  const entityId = c.req.param('entityId');

  if (!['task', 'project', 'event'].includes(entityType)) {
    return c.json({ success: false, error: 'Invalid entity type' }, 400);
  }

  const service = getStorageService();
  const attachments = await service.listForEntity(entityType, entityId, userId);

  return c.json({
    success: true,
    data: attachments,
  });
});

export default app;
