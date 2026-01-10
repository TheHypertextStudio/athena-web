/**
 * Initiative OpenAPI route definitions.
 *
 * These route definitions are used with OpenAPIHono to provide:
 * - Type-safe request/response handling
 * - OpenAPI spec generation
 * - Scalar documentation
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  InitiativeIdParamSchema,
  ListInitiativesQuerySchema,
  CreateInitiativeRequestSchema,
  UpdateInitiativeRequestSchema,
  InitiativeResponseSchema,
  InitiativeListResponseSchema,
} from '@athena/types/openapi/initiatives';
import {
  NotFoundErrorSchema,
  UnauthorizedErrorSchema,
  ValidationErrorSchema,
} from '@athena/types/openapi/common';

// =============================================================================
// List Initiatives
// =============================================================================

export const listInitiatives = createRoute({
  method: 'get',
  path: '/',
  tags: ['Initiatives'],
  summary: 'List initiatives',
  description: 'Retrieve a list of initiatives with optional filtering and pagination.',
  request: {
    query: ListInitiativesQuerySchema,
  },
  responses: {
    200: {
      description: 'Initiatives retrieved successfully',
      content: {
        'application/json': {
          schema: InitiativeListResponseSchema,
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
// Get Initiative
// =============================================================================

export const getInitiative = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Initiatives'],
  summary: 'Get an initiative',
  description: 'Retrieve a single initiative by its ID.',
  request: {
    params: InitiativeIdParamSchema,
  },
  responses: {
    200: {
      description: 'Initiative retrieved successfully',
      content: {
        'application/json': {
          schema: InitiativeResponseSchema,
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
      description: 'Initiative not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Create Initiative
// =============================================================================

export const createInitiative = createRoute({
  method: 'post',
  path: '/',
  tags: ['Initiatives'],
  summary: 'Create an initiative',
  description: 'Create a new initiative.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateInitiativeRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Initiative created successfully',
      content: {
        'application/json': {
          schema: InitiativeResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ValidationErrorSchema,
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
// Update Initiative
// =============================================================================

export const updateInitiative = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Initiatives'],
  summary: 'Update an initiative',
  description: 'Update an existing initiative. Only provided fields will be updated.',
  request: {
    params: InitiativeIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateInitiativeRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Initiative updated successfully',
      content: {
        'application/json': {
          schema: InitiativeResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ValidationErrorSchema,
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
      description: 'Initiative not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Initiative
// =============================================================================

export const deleteInitiative = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Initiatives'],
  summary: 'Delete an initiative',
  description: 'Soft-delete an initiative by its ID.',
  request: {
    params: InitiativeIdParamSchema,
  },
  responses: {
    204: {
      description: 'Initiative deleted successfully',
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
      description: 'Initiative not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});
