/**
 * Moment routes.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import { eq, and, gte, lte } from 'drizzle-orm';
import {
  MomentIdParamSchema,
  MomentsQuerySchema,
  CreateMomentRequestSchema,
  UpdateMomentRequestSchema,
  MomentsResponseSchema,
  MomentResponseSchema,
} from '@athena/types/openapi/moments';
import { ErrorResponseSchema, UnauthorizedErrorSchema } from '@athena/types/openapi/common';
import { db } from '../db/index.js';
import { moments } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import { toMoment } from './moments/serializers.js';

const momentRoutes = createOpenAPIApp();

momentRoutes.use('*', requireAuth);

const ERROR_MOMENT_NOT_FOUND = 'Moment not found';

// =============================================================================
// List Moments
// =============================================================================

const listMoments = createRoute({
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

const getMoment = createRoute({
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
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Create Moment
// =============================================================================

const createMoment = createRoute({
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

const updateMoment = createRoute({
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
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Moment
// =============================================================================

const deleteMoment = createRoute({
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
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * List all moments for the authenticated user.
 * GET /api/moments
 */
momentRoutes.openapi(listMoments, async (c) => {
  const userId = getUserId(c);
  const { startDate, endDate } = c.req.valid('query');

  const conditions = [eq(moments.ownerId, userId)];

  if (startDate) {
    conditions.push(gte(moments.startTime, startDate));
  }

  if (endDate) {
    conditions.push(lte(moments.endTime, endDate));
  }

  const result = await db.query.moments.findMany({
    where: and(...conditions),
    orderBy: (moments, { desc }) => [desc(moments.startTime)],
  });

  return c.json({ data: result.map((moment) => toMoment(moment)) }, 200);
});

/**
 * Get a single moment by ID.
 * GET /api/moments/:id
 */
momentRoutes.openapi(getMoment, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const result = await db.query.moments.findFirst({
    where: and(eq(moments.id, id), eq(moments.ownerId, userId)),
  });

  if (!result) {
    return c.json({ error: ERROR_MOMENT_NOT_FOUND }, 404);
  }

  return c.json({ data: toMoment(result) }, 200);
});

/**
 * Create a new moment.
 * POST /api/moments
 */
momentRoutes.openapi(createMoment, async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(moments).values({
    id,
    label: body.label,
    description: body.description,
    startTime: body.startTime,
    endTime: body.endTime,
    ownerId: userId,
    createdAt: now,
    updatedAt: now,
  });

  const result = await db.query.moments.findFirst({
    where: eq(moments.id, id),
  });

  if (!result) {
    throw new Error('Failed to create moment');
  }

  return c.json({ data: toMoment(result) }, 201);
});

/**
 * Update a moment.
 * PATCH /api/moments/:id
 */
momentRoutes.openapi(updateMoment, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const existing = await db.query.moments.findFirst({
    where: and(eq(moments.id, id), eq(moments.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: ERROR_MOMENT_NOT_FOUND }, 404);
  }

  const updateData: Partial<typeof moments.$inferInsert> = { updatedAt: new Date() };
  if (body.label !== undefined) updateData.label = body.label;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.startTime !== undefined) updateData.startTime = body.startTime;
  if (body.endTime !== undefined) updateData.endTime = body.endTime;

  await db
    .update(moments)
    .set(updateData)
    .where(and(eq(moments.id, id), eq(moments.ownerId, userId)));

  const result = await db.query.moments.findFirst({
    where: eq(moments.id, id),
  });

  if (!result) {
    return c.json({ error: ERROR_MOMENT_NOT_FOUND }, 404);
  }

  return c.json({ data: toMoment(result) }, 200);
});

/**
 * Delete a moment.
 * DELETE /api/moments/:id
 */
momentRoutes.openapi(deleteMoment, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const existing = await db.query.moments.findFirst({
    where: and(eq(moments.id, id), eq(moments.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: ERROR_MOMENT_NOT_FOUND }, 404);
  }

  await db.delete(moments).where(and(eq(moments.id, id), eq(moments.ownerId, userId)));

  return c.body(null, 204);
});

export { momentRoutes };
