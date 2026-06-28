/**
 * Initiative status routes with OpenAPI documentation.
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
import { createOpenAPIApp } from '../lib/openapi.js';
import { requireAuth } from '../middleware/auth.js';
import { createServiceContext } from '../lib/service.js';
import { InitiativeStatusService } from '../services/initiative-statuses/index.js';

const initiativeStatusRoutes = createOpenAPIApp();

// Apply auth middleware to all routes
initiativeStatusRoutes.use('*', requireAuth);

// =============================================================================
// List Initiative Statuses
// =============================================================================

const listInitiativeStatuses = createRoute({
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

const listInitiativeStatusesGrouped = createRoute({
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

const getInitiativeStatus = createRoute({
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

const createInitiativeStatus = createRoute({
  method: 'post',
  path: '/',
  tags: ['Initiative Statuses'],
  summary: 'Create initiative status',
  description: 'Create a new custom initiative status.',
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

const updateInitiativeStatus = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Initiative Statuses'],
  summary: 'Update initiative status',
  description: 'Update a custom initiative status.',
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

const deleteInitiativeStatus = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Initiative Statuses'],
  summary: 'Delete initiative status',
  description: 'Delete a custom initiative status.',
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

const reorderInitiativeStatuses = createRoute({
  method: 'post',
  path: '/reorder',
  tags: ['Initiative Statuses'],
  summary: 'Reorder initiative statuses',
  description: 'Reorder initiative statuses within a workspace and category.',
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

const setDefaultStatus = createRoute({
  method: 'post',
  path: '/{id}/default',
  tags: ['Initiative Statuses'],
  summary: 'Set default initiative status',
  description: 'Set an initiative status as the default for a workspace and category.',
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
      description: 'Default initiative status set successfully',
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

// List initiative statuses
initiativeStatusRoutes.openapi(listInitiativeStatuses, async (c) => {
  const ctx = createServiceContext(c);
  const service = new InitiativeStatusService(ctx);
  const query = c.req.valid('query');
  const statuses = await service.list(query.workspaceId, query.category);
  return c.json({ data: statuses }, 200);
});

// List initiative statuses grouped by category
initiativeStatusRoutes.openapi(listInitiativeStatusesGrouped, async (c) => {
  const ctx = createServiceContext(c);
  const service = new InitiativeStatusService(ctx);
  const query = c.req.valid('query');
  const grouped = await service.listGrouped(query.workspaceId);
  return c.json({ data: grouped }, 200);
});

// Get initiative status by ID
initiativeStatusRoutes.openapi(getInitiativeStatus, async (c) => {
  const ctx = createServiceContext(c);
  const service = new InitiativeStatusService(ctx);
  const { id } = c.req.valid('param');
  const status = await service.get(id);
  return c.json({ data: status }, 200);
});

// Create initiative status
initiativeStatusRoutes.openapi(createInitiativeStatus, async (c) => {
  const ctx = createServiceContext(c);
  const service = new InitiativeStatusService(ctx);
  const input = c.req.valid('json');
  const status = await service.create(input);
  return c.json({ data: status }, 201);
});

// Update initiative status
initiativeStatusRoutes.openapi(updateInitiativeStatus, async (c) => {
  const ctx = createServiceContext(c);
  const service = new InitiativeStatusService(ctx);
  const { id } = c.req.valid('param');
  const input = c.req.valid('json');
  const status = await service.update(id, input);
  return c.json({ data: status }, 200);
});

// Delete initiative status
initiativeStatusRoutes.openapi(deleteInitiativeStatus, async (c) => {
  const ctx = createServiceContext(c);
  const service = new InitiativeStatusService(ctx);
  const { id } = c.req.valid('param');
  await service.delete(id);
  return c.body(null, 204);
});

// Reorder initiative statuses
initiativeStatusRoutes.openapi(reorderInitiativeStatuses, async (c) => {
  const ctx = createServiceContext(c);
  const service = new InitiativeStatusService(ctx);
  const input = c.req.valid('json');
  const statuses = await service.reorder(input);
  return c.json({ data: statuses }, 200);
});

// Set default status
initiativeStatusRoutes.openapi(setDefaultStatus, async (c) => {
  const ctx = createServiceContext(c);
  const service = new InitiativeStatusService(ctx);
  const { id } = c.req.valid('param');
  const input = c.req.valid('json');
  const status = await service.setAsDefault(id, input.workspaceId);
  return c.json({ data: status }, 200);
});

export { initiativeStatusRoutes };
