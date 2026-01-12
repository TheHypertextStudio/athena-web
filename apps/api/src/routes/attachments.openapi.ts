/**
 * Attachments OpenAPI route definitions.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
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

// =============================================================================
// Upload Attachment
// =============================================================================

export const uploadAttachment = createRoute({
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

export const getAttachmentInfo = createRoute({
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

export const downloadAttachment = createRoute({
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

export const getSignedUrl = createRoute({
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

export const deleteAttachment = createRoute({
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

export const listEntityAttachments = createRoute({
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
