/**
 * Activity and Activity Stream routes.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { eq, and, gte, lte } from 'drizzle-orm';
import { db } from '../db/index.js';
import { activityStreams, activities } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';

const activityRoutes = new Hono();

activityRoutes.use('*', requireAuth);

// ============================================================================
// Activity Streams
// ============================================================================

/**
 * List all activity streams for the authenticated user.
 * GET /api/activity-streams
 */
activityRoutes.get('/streams', async (c) => {
  const userId = getUserId(c);

  const result = await db.query.activityStreams.findMany({
    where: eq(activityStreams.ownerId, userId),
    with: {
      activities: {
        limit: 10,
        orderBy: (activities, { desc }) => [desc(activities.startTime)],
      },
    },
    orderBy: (activityStreams, { desc }) => [desc(activityStreams.createdAt)],
  });

  return c.json({ data: result });
});

/**
 * Get a single activity stream by ID.
 * GET /api/activity-streams/:id
 */
activityRoutes.get('/streams/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const result = await db.query.activityStreams.findFirst({
    where: and(eq(activityStreams.id, id), eq(activityStreams.ownerId, userId)),
    with: {
      activities: {
        orderBy: (activities, { desc }) => [desc(activities.startTime)],
      },
    },
  });

  if (!result) {
    return c.json({ error: 'Activity stream not found' }, 404);
  }

  return c.json({ data: result });
});

/**
 * Create a new activity stream.
 * POST /api/activity-streams
 */
activityRoutes.post('/streams', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{
    name: string;
    source: string;
  }>();

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

  return c.json({ data: result }, 201);
});

/**
 * Update an activity stream.
 * PATCH /api/activity-streams/:id
 */
activityRoutes.patch('/streams/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    source?: string;
  }>();

  const existing = await db.query.activityStreams.findFirst({
    where: and(eq(activityStreams.id, id), eq(activityStreams.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: 'Activity stream not found' }, 404);
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updateData['name'] = body.name;
  if (body.source !== undefined) updateData['source'] = body.source;

  await db
    .update(activityStreams)
    .set(updateData)
    .where(and(eq(activityStreams.id, id), eq(activityStreams.ownerId, userId)));

  const result = await db.query.activityStreams.findFirst({
    where: eq(activityStreams.id, id),
  });

  return c.json({ data: result });
});

/**
 * Delete an activity stream.
 * DELETE /api/activity-streams/:id
 */
activityRoutes.delete('/streams/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const existing = await db.query.activityStreams.findFirst({
    where: and(eq(activityStreams.id, id), eq(activityStreams.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: 'Activity stream not found' }, 404);
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
activityRoutes.get('/streams/:streamId/activities', async (c) => {
  const userId = getUserId(c);
  const streamId = c.req.param('streamId');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  // Verify stream ownership
  const stream = await db.query.activityStreams.findFirst({
    where: and(eq(activityStreams.id, streamId), eq(activityStreams.ownerId, userId)),
  });

  if (!stream) {
    return c.json({ error: 'Activity stream not found' }, 404);
  }

  const conditions = [eq(activities.streamId, streamId)];

  if (startDate) {
    conditions.push(gte(activities.startTime, new Date(startDate)));
  }

  if (endDate) {
    conditions.push(lte(activities.endTime, new Date(endDate)));
  }

  const result = await db.query.activities.findMany({
    where: and(...conditions),
    orderBy: (activities, { desc }) => [desc(activities.startTime)],
  });

  return c.json({ data: result });
});

/**
 * Get a single activity by ID.
 * GET /api/activities/:id
 */
activityRoutes.get('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const result = await db.query.activities.findFirst({
    where: eq(activities.id, id),
    with: {
      stream: true,
    },
  });

  if (!result) {
    return c.json({ error: 'Activity not found' }, 404);
  }

  // Verify stream ownership
  const stream = await db.query.activityStreams.findFirst({
    where: and(eq(activityStreams.id, result.streamId), eq(activityStreams.ownerId, userId)),
  });

  if (!stream) {
    return c.json({ error: 'Activity not found' }, 404);
  }

  return c.json({ data: result });
});

/**
 * Create a new activity.
 * POST /api/activity-streams/:streamId/activities
 */
activityRoutes.post('/streams/:streamId/activities', async (c) => {
  const userId = getUserId(c);
  const streamId = c.req.param('streamId');
  const body = await c.req.json<{
    type: string;
    startTime: string;
    endTime: string;
    metadata?: Record<string, unknown>;
  }>();

  // Verify stream ownership
  const stream = await db.query.activityStreams.findFirst({
    where: and(eq(activityStreams.id, streamId), eq(activityStreams.ownerId, userId)),
  });

  if (!stream) {
    return c.json({ error: 'Activity stream not found' }, 404);
  }

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(activities).values({
    id,
    type: body.type,
    startTime: new Date(body.startTime),
    endTime: new Date(body.endTime),
    metadata: body.metadata,
    streamId,
    createdAt: now,
    updatedAt: now,
  });

  const result = await db.query.activities.findFirst({
    where: eq(activities.id, id),
  });

  return c.json({ data: result }, 201);
});

/**
 * Update an activity.
 * PATCH /api/activities/:id
 */
activityRoutes.patch('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json<{
    type?: string;
    startTime?: string;
    endTime?: string;
    metadata?: Record<string, unknown>;
  }>();

  const existing = await db.query.activities.findFirst({
    where: eq(activities.id, id),
    with: {
      stream: true,
    },
  });

  if (!existing) {
    return c.json({ error: 'Activity not found' }, 404);
  }

  // Verify stream ownership
  const stream = await db.query.activityStreams.findFirst({
    where: and(eq(activityStreams.id, existing.streamId), eq(activityStreams.ownerId, userId)),
  });

  if (!stream) {
    return c.json({ error: 'Activity not found' }, 404);
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.type !== undefined) updateData['type'] = body.type;
  if (body.startTime !== undefined) updateData['startTime'] = new Date(body.startTime);
  if (body.endTime !== undefined) updateData['endTime'] = new Date(body.endTime);
  if (body.metadata !== undefined) updateData['metadata'] = body.metadata;

  await db.update(activities).set(updateData).where(eq(activities.id, id));

  const result = await db.query.activities.findFirst({
    where: eq(activities.id, id),
  });

  return c.json({ data: result });
});

/**
 * Delete an activity.
 * DELETE /api/activities/:id
 */
activityRoutes.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const existing = await db.query.activities.findFirst({
    where: eq(activities.id, id),
  });

  if (!existing) {
    return c.json({ error: 'Activity not found' }, 404);
  }

  // Verify stream ownership
  const stream = await db.query.activityStreams.findFirst({
    where: and(eq(activityStreams.id, existing.streamId), eq(activityStreams.ownerId, userId)),
  });

  if (!stream) {
    return c.json({ error: 'Activity not found' }, 404);
  }

  await db.delete(activities).where(eq(activities.id, id));

  return c.body(null, 204);
});

export { activityRoutes };
