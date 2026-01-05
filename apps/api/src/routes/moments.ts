/**
 * Moment routes.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { eq, and, gte, lte } from 'drizzle-orm';
import { db } from '../db/index.js';
import { moments } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';

const momentRoutes = new Hono();

momentRoutes.use('*', requireAuth);

/**
 * List all moments for the authenticated user.
 * GET /api/moments
 */
momentRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  const conditions = [eq(moments.ownerId, userId)];

  if (startDate) {
    conditions.push(gte(moments.startTime, new Date(startDate)));
  }

  if (endDate) {
    conditions.push(lte(moments.endTime, new Date(endDate)));
  }

  const result = await db.query.moments.findMany({
    where: and(...conditions),
    orderBy: (moments, { desc }) => [desc(moments.startTime)],
  });

  return c.json({ data: result });
});

/**
 * Get a single moment by ID.
 * GET /api/moments/:id
 */
momentRoutes.get('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const result = await db.query.moments.findFirst({
    where: and(eq(moments.id, id), eq(moments.ownerId, userId)),
  });

  if (!result) {
    return c.json({ error: 'Moment not found' }, 404);
  }

  return c.json({ data: result });
});

/**
 * Create a new moment.
 * POST /api/moments
 */
momentRoutes.post('/', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{
    label?: string;
    description?: string;
    startTime: string;
    endTime: string;
  }>();

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(moments).values({
    id,
    label: body.label,
    description: body.description,
    startTime: new Date(body.startTime),
    endTime: new Date(body.endTime),
    ownerId: userId,
    createdAt: now,
    updatedAt: now,
  });

  const result = await db.query.moments.findFirst({
    where: eq(moments.id, id),
  });

  return c.json({ data: result }, 201);
});

/**
 * Update a moment.
 * PATCH /api/moments/:id
 */
momentRoutes.patch('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json<{
    label?: string;
    description?: string;
    startTime?: string;
    endTime?: string;
  }>();

  const existing = await db.query.moments.findFirst({
    where: and(eq(moments.id, id), eq(moments.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: 'Moment not found' }, 404);
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.label !== undefined) updateData['label'] = body.label;
  if (body.description !== undefined) updateData['description'] = body.description;
  if (body.startTime !== undefined) updateData['startTime'] = new Date(body.startTime);
  if (body.endTime !== undefined) updateData['endTime'] = new Date(body.endTime);

  await db
    .update(moments)
    .set(updateData)
    .where(and(eq(moments.id, id), eq(moments.ownerId, userId)));

  const result = await db.query.moments.findFirst({
    where: eq(moments.id, id),
  });

  return c.json({ data: result });
});

/**
 * Delete a moment.
 * DELETE /api/moments/:id
 */
momentRoutes.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const existing = await db.query.moments.findFirst({
    where: and(eq(moments.id, id), eq(moments.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: 'Moment not found' }, 404);
  }

  await db.delete(moments).where(and(eq(moments.id, id), eq(moments.ownerId, userId)));

  return c.json({ success: true });
});

export { momentRoutes };
