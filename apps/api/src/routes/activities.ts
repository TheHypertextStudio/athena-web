/**
 * Activity and Activity Stream routes.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  ActivityStreamIdParamSchema,
  StreamIdParamSchema,
  ActivityIdParamSchema,
  ActivitiesQuerySchema,
  CreateActivityStreamRequestSchema,
  UpdateActivityStreamRequestSchema,
  CreateActivityRequestSchema,
  UpdateActivityRequestSchema,
  ActivityStreamsResponseSchema,
  ActivityStreamResponseSchema,
  CreateActivityStreamResponseSchema,
  UpdateActivityStreamResponseSchema,
  ActivitiesResponseSchema,
  ActivityResponseSchema,
  CreateActivityResponseSchema,
} from '@athena/types/openapi/activities';
import { ErrorResponseSchema, UnauthorizedErrorSchema } from '@athena/types/openapi/common';
import { eq, and, gte, lte } from 'drizzle-orm';
import { db } from '../db/index.js';
import { activityStreams, activities } from '../db/schema/index.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import {
  toActivity,
  toActivityStream,
  toActivityStreamWithActivities,
  toActivityWithStream,
} from './activities/serializers.js';

const activityRoutes = createOpenAPIApp();

activityRoutes.use('*', requireAuth);

const DEFAULT_STREAM_ACTIVITIES_LIMIT = 10;
const ERROR_ACTIVITY_STREAM_NOT_FOUND = 'Activity stream not found';
const ERROR_ACTIVITY_NOT_FOUND = 'Activity not found';

// =============================================================================
// OpenAPI Route Definitions
// =============================================================================

const listStreams = createRoute({
  method: 'get',
  path: '/streams',
  tags: ['Activities'],
  summary: 'List activity streams',
  description: 'List all activity streams for the authenticated user.',
  responses: {
    200: {
      description: 'Activity streams retrieved successfully',
      content: {
        'application/json': {
          schema: ActivityStreamsResponseSchema,
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

const getStream = createRoute({
  method: 'get',
  path: '/streams/{id}',
  tags: ['Activities'],
  summary: 'Get activity stream',
  description: 'Get an activity stream by ID.',
  request: {
    params: ActivityStreamIdParamSchema,
  },
  responses: {
    200: {
      description: 'Activity stream retrieved successfully',
      content: {
        'application/json': {
          schema: ActivityStreamResponseSchema,
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
      description: 'Activity stream not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const createStream = createRoute({
  method: 'post',
  path: '/streams',
  tags: ['Activities'],
  summary: 'Create activity stream',
  description: 'Create a new activity stream.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateActivityStreamRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Activity stream created successfully',
      content: {
        'application/json': {
          schema: CreateActivityStreamResponseSchema,
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

const updateStream = createRoute({
  method: 'patch',
  path: '/streams/{id}',
  tags: ['Activities'],
  summary: 'Update activity stream',
  description: 'Update an activity stream.',
  request: {
    params: ActivityStreamIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateActivityStreamRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Activity stream updated successfully',
      content: {
        'application/json': {
          schema: UpdateActivityStreamResponseSchema,
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
      description: 'Activity stream not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const deleteStream = createRoute({
  method: 'delete',
  path: '/streams/{id}',
  tags: ['Activities'],
  summary: 'Delete activity stream',
  description: 'Delete an activity stream.',
  request: {
    params: ActivityStreamIdParamSchema,
  },
  responses: {
    204: {
      description: 'Activity stream deleted successfully',
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
      description: 'Activity stream not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const listActivities = createRoute({
  method: 'get',
  path: '/streams/{streamId}/activities',
  tags: ['Activities'],
  summary: 'List activities',
  description: 'List activities for a stream.',
  request: {
    params: StreamIdParamSchema,
    query: ActivitiesQuerySchema,
  },
  responses: {
    200: {
      description: 'Activities retrieved successfully',
      content: {
        'application/json': {
          schema: ActivitiesResponseSchema,
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
      description: 'Activity stream not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const getActivity = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Activities'],
  summary: 'Get activity',
  description: 'Get an activity by ID.',
  request: {
    params: ActivityIdParamSchema,
  },
  responses: {
    200: {
      description: 'Activity retrieved successfully',
      content: {
        'application/json': {
          schema: ActivityResponseSchema,
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
      description: 'Activity not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const createActivity = createRoute({
  method: 'post',
  path: '/streams/{streamId}/activities',
  tags: ['Activities'],
  summary: 'Create activity',
  description: 'Create a new activity in a stream.',
  request: {
    params: StreamIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: CreateActivityRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Activity created successfully',
      content: {
        'application/json': {
          schema: CreateActivityResponseSchema,
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
      description: 'Activity stream not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const updateActivity = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Activities'],
  summary: 'Update activity',
  description: 'Update an activity.',
  request: {
    params: ActivityIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateActivityRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Activity updated successfully',
      content: {
        'application/json': {
          schema: ActivityResponseSchema,
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
      description: 'Activity not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const deleteActivity = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Activities'],
  summary: 'Delete activity',
  description: 'Delete an activity.',
  request: {
    params: ActivityIdParamSchema,
  },
  responses: {
    204: {
      description: 'Activity deleted successfully',
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
      description: 'Activity not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// ============================================================================
// Activity Streams
// ============================================================================

/**
 * List all activity streams for the authenticated user.
 * GET /api/activity-streams
 */
activityRoutes.openapi(listStreams, async (c) => {
  const userId = getUserId(c);

  const result = await db.query.activityStreams.findMany({
    where: eq(activityStreams.ownerId, userId),
    with: {
      activities: {
        limit: DEFAULT_STREAM_ACTIVITIES_LIMIT,
        orderBy: (activities, { desc }) => [desc(activities.startTime)],
      },
    },
    orderBy: (activityStreams, { desc }) => [desc(activityStreams.createdAt)],
  });

  return c.json({ data: result.map(toActivityStreamWithActivities) }, 200);
});

/**
 * Get a single activity stream by ID.
 * GET /api/activity-streams/:id
 */
activityRoutes.openapi(getStream, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const result = await db.query.activityStreams.findFirst({
    where: and(eq(activityStreams.id, id), eq(activityStreams.ownerId, userId)),
    with: {
      activities: {
        orderBy: (activities, { desc }) => [desc(activities.startTime)],
      },
    },
  });

  if (!result) {
    return c.json({ error: ERROR_ACTIVITY_STREAM_NOT_FOUND }, 404);
  }

  return c.json({ data: toActivityStreamWithActivities(result) }, 200);
});

/**
 * Create a new activity stream.
 * POST /api/activity-streams
 */
activityRoutes.openapi(createStream, async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(activityStreams).values({
    id,
    name: body.name,
    source: body.source,
    ownerId: userId,
    createdAt: now,
    updatedAt: now,
  });

  const result = await db.query.activityStreams.findFirst({
    where: eq(activityStreams.id, id),
  });

  if (!result) {
    throw new Error('Failed to create activity stream');
  }

  return c.json({ data: toActivityStream(result) }, 201);
});

/**
 * Update an activity stream.
 * PATCH /api/activity-streams/:id
 */
activityRoutes.openapi(updateStream, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const existing = await db.query.activityStreams.findFirst({
    where: and(eq(activityStreams.id, id), eq(activityStreams.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: ERROR_ACTIVITY_STREAM_NOT_FOUND }, 404);
  }

  const updateData: Partial<typeof activityStreams.$inferInsert> = { updatedAt: new Date() };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.source !== undefined) updateData.source = body.source;

  await db
    .update(activityStreams)
    .set(updateData)
    .where(and(eq(activityStreams.id, id), eq(activityStreams.ownerId, userId)));

  const result = await db.query.activityStreams.findFirst({
    where: eq(activityStreams.id, id),
  });

  if (!result) {
    throw new Error('Failed to update activity stream');
  }

  return c.json({ data: toActivityStream(result) }, 200);
});

/**
 * Delete an activity stream.
 * DELETE /api/activity-streams/:id
 */
activityRoutes.openapi(deleteStream, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const existing = await db.query.activityStreams.findFirst({
    where: and(eq(activityStreams.id, id), eq(activityStreams.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: ERROR_ACTIVITY_STREAM_NOT_FOUND }, 404);
  }

  await db
    .delete(activityStreams)
    .where(and(eq(activityStreams.id, id), eq(activityStreams.ownerId, userId)));

  return c.body(null, 204);
});

// ============================================================================
// Activities
// ============================================================================

/**
 * List activities for a stream.
 * GET /api/activity-streams/:streamId/activities
 */
activityRoutes.openapi(listActivities, async (c) => {
  const userId = getUserId(c);
  const { streamId } = c.req.valid('param');
  const { startDate, endDate } = c.req.valid('query');

  // Verify stream ownership
  const stream = await db.query.activityStreams.findFirst({
    where: and(eq(activityStreams.id, streamId), eq(activityStreams.ownerId, userId)),
  });

  if (!stream) {
    return c.json({ error: ERROR_ACTIVITY_STREAM_NOT_FOUND }, 404);
  }

  const conditions = [eq(activities.streamId, streamId)];

  if (startDate) {
    conditions.push(gte(activities.startTime, startDate));
  }

  if (endDate) {
    conditions.push(lte(activities.endTime, endDate));
  }

  const result = await db.query.activities.findMany({
    where: and(...conditions),
    orderBy: (activities, { desc }) => [desc(activities.startTime)],
  });

  return c.json({ data: result.map(toActivity) }, 200);
});

/**
 * Get a single activity by ID.
 * GET /api/activities/:id
 */
activityRoutes.openapi(getActivity, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const result = await db.query.activities.findFirst({
    where: eq(activities.id, id),
    with: {
      stream: true,
    },
  });

  if (!result) {
    return c.json({ error: ERROR_ACTIVITY_NOT_FOUND }, 404);
  }

  // Verify stream ownership
  const stream = await db.query.activityStreams.findFirst({
    where: and(eq(activityStreams.id, result.streamId), eq(activityStreams.ownerId, userId)),
  });

  if (!stream) {
    return c.json({ error: ERROR_ACTIVITY_NOT_FOUND }, 404);
  }

  return c.json({ data: toActivityWithStream(result) }, 200);
});

/**
 * Create a new activity.
 * POST /api/activity-streams/:streamId/activities
 */
activityRoutes.openapi(createActivity, async (c) => {
  const userId = getUserId(c);
  const { streamId } = c.req.valid('param');
  const body = c.req.valid('json');

  // Verify stream ownership
  const stream = await db.query.activityStreams.findFirst({
    where: and(eq(activityStreams.id, streamId), eq(activityStreams.ownerId, userId)),
  });

  if (!stream) {
    return c.json({ error: ERROR_ACTIVITY_STREAM_NOT_FOUND }, 404);
  }

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(activities).values({
    id,
    type: body.type,
    startTime: body.startTime,
    endTime: body.endTime,
    metadata: body.metadata,
    streamId,
    createdAt: now,
    updatedAt: now,
  });

  const result = await db.query.activities.findFirst({
    where: eq(activities.id, id),
  });

  if (!result) {
    throw new Error('Failed to create activity');
  }

  return c.json({ data: toActivity(result) }, 201);
});

/**
 * Update an activity.
 * PATCH /api/activities/:id
 */
activityRoutes.openapi(updateActivity, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const existing = await db.query.activities.findFirst({
    where: eq(activities.id, id),
    with: {
      stream: true,
    },
  });

  if (!existing) {
    return c.json({ error: ERROR_ACTIVITY_NOT_FOUND }, 404);
  }

  // Verify stream ownership
  const stream = await db.query.activityStreams.findFirst({
    where: and(eq(activityStreams.id, existing.streamId), eq(activityStreams.ownerId, userId)),
  });

  if (!stream) {
    return c.json({ error: ERROR_ACTIVITY_NOT_FOUND }, 404);
  }

  const updateData: Partial<typeof activities.$inferInsert> = { updatedAt: new Date() };
  if (body.type !== undefined) updateData.type = body.type;
  if (body.startTime !== undefined) updateData.startTime = body.startTime;
  if (body.endTime !== undefined) updateData.endTime = body.endTime;
  if (body.metadata !== undefined) updateData.metadata = body.metadata;

  await db.update(activities).set(updateData).where(eq(activities.id, id));

  const result = await db.query.activities.findFirst({
    where: eq(activities.id, id),
  });

  if (!result) {
    throw new Error('Failed to update activity');
  }

  return c.json({ data: toActivity(result) }, 200);
});

/**
 * Delete an activity.
 * DELETE /api/activities/:id
 */
activityRoutes.openapi(deleteActivity, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const existing = await db.query.activities.findFirst({
    where: eq(activities.id, id),
  });

  if (!existing) {
    return c.json({ error: ERROR_ACTIVITY_NOT_FOUND }, 404);
  }

  // Verify stream ownership
  const stream = await db.query.activityStreams.findFirst({
    where: and(eq(activityStreams.id, existing.streamId), eq(activityStreams.ownerId, userId)),
  });

  if (!stream) {
    return c.json({ error: ERROR_ACTIVITY_NOT_FOUND }, 404);
  }

  await db.delete(activities).where(eq(activities.id, id));

  return c.body(null, 204);
});

export { activityRoutes };
