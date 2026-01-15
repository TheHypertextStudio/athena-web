/**
 * Initiative Status OpenAPI route definitions.
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
  InitiativeStatusIdParamSchema,
  ListInitiativeStatusesQuerySchema,
  CreateInitiativeStatusRequestSchema,
  UpdateInitiativeStatusRequestSchema,
  ReorderInitiativeStatusesRequestSchema,
  SetDefaultInitiativeStatusRequestSchema,
  InitiativeStatusResponseSchema,
  InitiativeStatusListResponseSchema,
  GroupedInitiativeStatusesResponseSchema,
} from '@athena/types/openapi/initiative-statuses';
import {
  NotFoundErrorSchema,
  UnauthorizedErrorSchema,
  ValidationErrorSchema,
} from '@athena/types/openapi/common';

// =============================================================================
// List Initiative Statuses
// =============================================================================

export const listInitiativeStatuses = createRoute({
  method: 'get',
  path: '/',
  tags: ['Initiative Statuses'],
  summary: 'List initiative statuses',
  description: 'Retrieve all custom initiative statuses for a workspace.',
  request: {
    query: ListInitiativeStatusesQuerySchema,
  },
  responses: {
    200: {
      description: 'Initiative statuses retrieved successfully',
      content: {
        'application/json': {
          schema: InitiativeStatusListResponseSchema,
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
// List Initiative Statuses Grouped
// =============================================================================

export const listInitiativeStatusesGrouped = createRoute({
  method: 'get',
  path: '/grouped',
  tags: ['Initiative Statuses'],
  summary: 'List initiative statuses grouped by category',
  description:
    'Retrieve all custom initiative statuses grouped by their category (planning, active, completed, archived).',
  request: {
    query: ListInitiativeStatusesQuerySchema,
  },
  responses: {
    200: {
      description: 'Grouped initiative statuses retrieved successfully',
      content: {
        'application/json': {
          schema: GroupedInitiativeStatusesResponseSchema,
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
// Get Initiative Status
// =============================================================================

export const getInitiativeStatus = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Initiative Statuses'],
  summary: 'Get an initiative status',
  description: 'Retrieve a single custom initiative status by its ID.',
  request: {
    params: InitiativeStatusIdParamSchema,
  },
  responses: {
    200: {
      description: 'Initiative status retrieved successfully',
      content: {
        'application/json': {
          schema: InitiativeStatusResponseSchema,
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
      description: 'Initiative status not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Create Initiative Status
// =============================================================================

export const createInitiativeStatus = createRoute({
  method: 'post',
  path: '/',
  tags: ['Initiative Statuses'],
  summary: 'Create an initiative status',
  description: 'Create a new custom initiative status for a workspace.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateInitiativeStatusRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Initiative status created successfully',
      content: {
        'application/json': {
          schema: InitiativeStatusResponseSchema,
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
// Update Initiative Status
// =============================================================================

export const updateInitiativeStatus = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Initiative Statuses'],
  summary: 'Update an initiative status',
  description: 'Update an existing custom initiative status. Only provided fields will be updated.',
  request: {
    params: InitiativeStatusIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateInitiativeStatusRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Initiative status updated successfully',
      content: {
        'application/json': {
          schema: InitiativeStatusResponseSchema,
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
      description: 'Initiative status not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Initiative Status
// =============================================================================

export const deleteInitiativeStatus = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Initiative Statuses'],
  summary: 'Delete an initiative status',
  description:
    'Delete a custom initiative status. Initiatives using this status should be reassigned first.',
  request: {
    params: InitiativeStatusIdParamSchema,
  },
  responses: {
    204: {
      description: 'Initiative status deleted successfully',
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
      description: 'Initiative status not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Reorder Initiative Statuses
// =============================================================================

export const reorderInitiativeStatuses = createRoute({
  method: 'post',
  path: '/reorder',
  tags: ['Initiative Statuses'],
  summary: 'Reorder initiative statuses',
  description: 'Reorder initiative statuses within a category by specifying the new order.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: ReorderInitiativeStatusesRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Initiative statuses reordered successfully',
      content: {
        'application/json': {
          schema: InitiativeStatusListResponseSchema,
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
// Set Default Status
// =============================================================================

export const setDefaultStatus = createRoute({
  method: 'post',
  path: '/{id}/set-default',
  tags: ['Initiative Statuses'],
  summary: 'Set status as default',
  description:
    'Set an initiative status as the default for its category. New initiatives in this category will use this status.',
  request: {
    params: InitiativeStatusIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: SetDefaultInitiativeStatusRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Default status set successfully',
      content: {
        'application/json': {
          schema: InitiativeStatusResponseSchema,
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
      description: 'Initiative status not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});
