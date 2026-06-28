/**
 * Initiative routes.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import { eq, and } from 'drizzle-orm';
import {
  InitiativeIdParamSchema,
  InitiativeResponseSchema,
  InitiativeListResponseSchema,
} from '@athena/types/openapi/initiatives';
import type { InitiativeStatus } from '@athena/types/openapi/initiatives';
import {
  ErrorResponseSchema,
  UnauthorizedErrorSchema,
  ValidationErrorSchema,
} from '@athena/types/openapi/common';
import { db } from '../db/index.js';
import { initiatives } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import type { InitiativeStatusCategory } from './initiatives/helpers.js';
import {
  buildValidationError,
  getCustomStatus,
  getDefaultStatus,
  toInitiativeStatus,
  toStatusCategory,
} from './initiatives/helpers.js';
import {
  CreateInitiativeRequestWithStatusSchema,
  InitiativeMetricsResponseSchema,
  ListInitiativesQueryWithStatusSchema,
  UpdateInitiativeRequestWithStatusSchema,
} from './initiatives/schemas.js';
import { toInitiativeWithRelations } from './initiatives/serializers.js';
import { buildInitiativeMetrics } from './initiatives/metrics.js';

const initiativeRoutes = createOpenAPIApp();

// All initiative routes require authentication
initiativeRoutes.use('*', requireAuth);

const ERROR_INITIATIVE_NOT_FOUND = 'Initiative not found';

// =============================================================================
// List Initiatives
// =============================================================================

const listInitiatives = createRoute({
  method: 'get',
  path: '/',
  tags: ['Initiatives'],
  summary: 'List initiatives',
  description: 'Retrieve a list of initiatives with optional filtering and pagination.',
  request: {
    query: ListInitiativesQueryWithStatusSchema,
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

const getInitiative = createRoute({
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
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Create Initiative
// =============================================================================

const createInitiative = createRoute({
  method: 'post',
  path: '/',
  tags: ['Initiatives'],
  summary: 'Create an initiative',
  description: 'Create a new initiative.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateInitiativeRequestWithStatusSchema,
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

const updateInitiative = createRoute({
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
          schema: UpdateInitiativeRequestWithStatusSchema,
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
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Initiative
// =============================================================================

const deleteInitiative = createRoute({
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
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Initiative Metrics
// =============================================================================

const getInitiativeMetrics = createRoute({
  method: 'get',
  path: '/{id}/metrics',
  tags: ['Initiatives'],
  summary: 'Get initiative metrics',
  description: 'Get aggregated metrics for an initiative.',
  request: {
    params: InitiativeIdParamSchema,
  },
  responses: {
    200: {
      description: 'Initiative metrics retrieved',
      content: {
        'application/json': {
          schema: InitiativeMetricsResponseSchema,
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
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * List all initiatives for the authenticated user.
 * GET /api/initiatives
 *
 * Query params:
 * - category: Filter by status category (planning, active, completed, archived)
 * - statusId: Filter by specific status ID
 * - parentId: Filter by parent initiative
 */
initiativeRoutes.openapi(listInitiatives, async (c) => {
  const userId = getUserId(c);
  const { category, statusId, parentId, status, limit, offset } = c.req.valid('query');

  const conditions = [eq(initiatives.ownerId, userId)];

  if (statusId) {
    conditions.push(eq(initiatives.statusId, statusId));
  }

  const statusCategory = status ? toStatusCategory(status) : category;
  if (statusCategory) {
    conditions.push(eq(initiatives.statusCategory, statusCategory));
  }

  if (parentId) {
    conditions.push(eq(initiatives.parentId, parentId));
  }

  const result = await db.query.initiatives.findMany({
    where: and(...conditions),
    with: {
      parent: true,
      children: true,
      projects: { columns: { id: true } },
      owner: { columns: { id: true, name: true } },
    },
    orderBy: (initiatives, { desc }) => [desc(initiatives.createdAt)],
    limit,
    offset,
  });

  return c.json({ data: result.map(toInitiativeWithRelations) }, 200);
});

/**
 * Get a single initiative by ID.
 * GET /api/initiatives/:id
 */
initiativeRoutes.openapi(getInitiative, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const result = await db.query.initiatives.findFirst({
    where: and(eq(initiatives.id, id), eq(initiatives.ownerId, userId)),
    with: {
      parent: true,
      children: true,
      projects: { columns: { id: true } },
      owner: { columns: { id: true, name: true } },
    },
  });

  if (!result) {
    return c.json({ error: ERROR_INITIATIVE_NOT_FOUND }, 404);
  }

  return c.json({ data: toInitiativeWithRelations(result) }, 200);
});

/**
 * Create a new initiative.
 * POST /api/initiatives
 */
initiativeRoutes.openapi(createInitiative, async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');

  const id = crypto.randomUUID();
  const now = new Date();

  let customStatus = null;
  let statusCategory: InitiativeStatusCategory;
  let statusValue: InitiativeStatus = body.status;

  if (body.statusId) {
    customStatus = await getCustomStatus(body.statusId);
    if (!customStatus) {
      return c.json(buildValidationError('statusId', 'Invalid status ID'), 400);
    }
    statusCategory = customStatus.category;
    statusValue = toInitiativeStatus(statusCategory);

    if (toStatusCategory(body.status) !== statusCategory) {
      return c.json(
        buildValidationError('status', 'Status does not match the selected statusId'),
        400,
      );
    }
  } else {
    statusCategory = toStatusCategory(statusValue);
    customStatus = await getDefaultStatus(statusCategory);
    if (!customStatus) {
      return c.json(
        buildValidationError('status', 'No initiative statuses configured'),
        400,
      );
    }
  }

  await db.insert(initiatives).values({
    id,
    name: body.name,
    description: body.description,
    status: statusValue,
    statusId: customStatus.id,
    statusCategory,
    parentId: body.parentId,
    ownerId: userId,
    createdAt: now,
    updatedAt: now,
  });

  const result = await db.query.initiatives.findFirst({
    where: eq(initiatives.id, id),
    with: {
      parent: true,
      projects: { columns: { id: true } },
      owner: { columns: { id: true, name: true } },
    },
  });

  if (!result) {
    throw new Error('Initiative not found after creation');
  }

  return c.json({ data: toInitiativeWithRelations(result) }, 201);
});

/**
 * Update an initiative.
 * PATCH /api/initiatives/:id
 */
initiativeRoutes.openapi(updateInitiative, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const existing = await db.query.initiatives.findFirst({
    where: and(eq(initiatives.id, id), eq(initiatives.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: ERROR_INITIATIVE_NOT_FOUND }, 404);
  }

  // Build update data
  const updateData: {
    name?: string;
    description?: string | null;
    status?: InitiativeStatus;
    statusId?: string;
    statusCategory?: InitiativeStatusCategory;
    parentId?: string | null;
    updatedAt: Date;
  } = {
    updatedAt: new Date(),
  };

  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.parentId !== undefined) updateData.parentId = body.parentId;

  // Handle status update
  if (body.statusId) {
    const customStatus = await getCustomStatus(body.statusId);
    if (!customStatus) {
      return c.json(buildValidationError('statusId', 'Invalid status ID'), 400);
    }

    if (body.status && toStatusCategory(body.status) !== customStatus.category) {
      return c.json(
        buildValidationError('status', 'Status does not match the selected statusId'),
        400,
      );
    }

    updateData.statusId = customStatus.id;
    updateData.statusCategory = customStatus.category;
    updateData.status = toInitiativeStatus(customStatus.category);
  } else if (body.status) {
    const statusCategory = toStatusCategory(body.status);
    const customStatus = await getDefaultStatus(statusCategory);
    if (!customStatus) {
      return c.json(
        buildValidationError('status', 'No initiative statuses configured'),
        400,
      );
    }
    updateData.statusId = customStatus.id;
    updateData.statusCategory = statusCategory;
    updateData.status = body.status;
  }

  await db
    .update(initiatives)
    .set(updateData)
    .where(and(eq(initiatives.id, id), eq(initiatives.ownerId, userId)));

  const result = await db.query.initiatives.findFirst({
    where: eq(initiatives.id, id),
    with: {
      parent: true,
      children: true,
      projects: { columns: { id: true } },
      owner: { columns: { id: true, name: true } },
    },
  });

  if (!result) {
    throw new Error('Initiative not found after update');
  }

  return c.json({ data: toInitiativeWithRelations(result) }, 200);
});

/**
 * Delete an initiative.
 * DELETE /api/initiatives/:id
 */
initiativeRoutes.openapi(deleteInitiative, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const existing = await db.query.initiatives.findFirst({
    where: and(eq(initiatives.id, id), eq(initiatives.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: ERROR_INITIATIVE_NOT_FOUND }, 404);
  }

  await db.delete(initiatives).where(and(eq(initiatives.id, id), eq(initiatives.ownerId, userId)));

  return c.body(null, 204);
});

/**
 * Get metrics for an initiative.
 * GET /api/initiatives/:id/metrics
 *
 * Returns aggregated metrics including:
 * - Task counts by status
 * - Project stats with health indicators
 * - Time statistics (estimated, logged, remaining)
 * - Velocity (tasks completed per week)
 * - Projected completion date
 */
initiativeRoutes.openapi(getInitiativeMetrics, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  // Fetch initiative with all related data
  const initiative = await db.query.initiatives.findFirst({
    where: and(eq(initiatives.id, id), eq(initiatives.ownerId, userId)),
    with: {
      projects: {
        with: {
          tasks: true,
        },
      },
    },
  });

  if (!initiative) {
    return c.json({ error: ERROR_INITIATIVE_NOT_FOUND }, 404);
  }

  const metrics = buildInitiativeMetrics(initiative);

  return c.json({ data: metrics }, 200);
});

export { initiativeRoutes };
