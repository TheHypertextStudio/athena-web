/**
 * Moments OpenAPI route definitions.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  MomentIdParamSchema,
  MomentsQuerySchema,
  CreateMomentRequestSchema,
  UpdateMomentRequestSchema,
  MomentsResponseSchema,
  MomentResponseSchema,
} from '@athena/types/openapi/moments';
import { NotFoundErrorSchema, UnauthorizedErrorSchema } from '@athena/types/openapi/common';

// =============================================================================
// List Moments
// =============================================================================

export const listMoments = createRoute({
  method: 'get',
  path: '/',
  tags: ['Moments'],
  summary: 'List moments',
  description: 'List all moments for the authenticated user.',
  request: {
    query: MomentsQuerySchema,
  },
  responses: {
    200: {
      description: 'Moments retrieved successfully',
      content: {
        'application/json': {
          schema: MomentsResponseSchema,
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
// Get Moment
// =============================================================================

export const getMoment = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Moments'],
  summary: 'Get moment',
  description: 'Get a moment by ID.',
  request: {
    params: MomentIdParamSchema,
  },
  responses: {
    200: {
      description: 'Moment retrieved successfully',
      content: {
        'application/json': {
          schema: MomentResponseSchema,
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
      description: 'Moment not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Create Moment
// =============================================================================

export const createMoment = createRoute({
  method: 'post',
  path: '/',
  tags: ['Moments'],
  summary: 'Create moment',
  description: 'Create a new moment.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateMomentRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Moment created successfully',
      content: {
        'application/json': {
          schema: MomentResponseSchema,
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
// Update Moment
// =============================================================================

export const updateMoment = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Moments'],
  summary: 'Update moment',
  description: 'Update a moment.',
  request: {
    params: MomentIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateMomentRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Moment updated successfully',
      content: {
        'application/json': {
          schema: MomentResponseSchema,
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
      description: 'Moment not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Moment
// =============================================================================

export const deleteMoment = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Moments'],
  summary: 'Delete moment',
  description: 'Delete a moment.',
  request: {
    params: MomentIdParamSchema,
  },
  responses: {
    204: {
      description: 'Moment deleted successfully',
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
      description: 'Moment not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});
