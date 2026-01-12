/**
 * Tags OpenAPI route definitions.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  TagIdParamSchema,
  CreateTagRequestSchema,
  UpdateTagRequestSchema,
  TagsResponseSchema,
  TagResponseSchema,
  CreateTagResponseSchema,
} from '@athena/types/openapi/tags';
import { NotFoundErrorSchema, UnauthorizedErrorSchema } from '@athena/types/openapi/common';

// =============================================================================
// List Tags
// =============================================================================

export const listTags = createRoute({
  method: 'get',
  path: '/',
  tags: ['Tags'],
  summary: 'List tags',
  description: 'List all tags for the authenticated user.',
  responses: {
    200: {
      description: 'Tags retrieved successfully',
      content: {
        'application/json': {
          schema: TagsResponseSchema,
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
// Get Tag
// =============================================================================

export const getTag = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Tags'],
  summary: 'Get tag',
  description: 'Get a tag by ID.',
  request: {
    params: TagIdParamSchema,
  },
  responses: {
    200: {
      description: 'Tag retrieved successfully',
      content: {
        'application/json': {
          schema: TagResponseSchema,
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
      description: 'Tag not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Create Tag
// =============================================================================

export const createTag = createRoute({
  method: 'post',
  path: '/',
  tags: ['Tags'],
  summary: 'Create tag',
  description: 'Create a new tag.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateTagRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Tag created successfully',
      content: {
        'application/json': {
          schema: CreateTagResponseSchema,
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
// Update Tag
// =============================================================================

export const updateTag = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Tags'],
  summary: 'Update tag',
  description: 'Update a tag.',
  request: {
    params: TagIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateTagRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Tag updated successfully',
      content: {
        'application/json': {
          schema: TagResponseSchema,
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
      description: 'Tag not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Tag
// =============================================================================

export const deleteTag = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Tags'],
  summary: 'Delete tag',
  description: 'Delete a tag.',
  request: {
    params: TagIdParamSchema,
  },
  responses: {
    204: {
      description: 'Tag deleted successfully',
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
      description: 'Tag not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});
