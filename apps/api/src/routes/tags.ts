/**
 * Tag routes.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tags } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';

const tagRoutes = new Hono();

tagRoutes.use('*', requireAuth);

/**
 * List all tags for the authenticated user.
 * GET /api/tags
 */
tagRoutes.get('/', async (c) => {
  const userId = getUserId(c);

  const result = await db.query.tags.findMany({
    where: eq(tags.ownerId, userId),
    with: {
      tasks: {
        with: {
          task: true,
        },
      },
    },
    orderBy: (tags, { asc }) => [asc(tags.name)],
  });

  return c.json({ data: result });
});

/**
 * Get a single tag by ID.
 * GET /api/tags/:id
 */
tagRoutes.get('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const result = await db.query.tags.findFirst({
    where: and(eq(tags.id, id), eq(tags.ownerId, userId)),
    with: {
      tasks: {
        with: {
          task: true,
        },
      },
    },
  });

  if (!result) {
    return c.json({ error: 'Tag not found' }, 404);
  }

  return c.json({ data: result });
});

/**
 * Create a new tag.
 * POST /api/tags
 */
tagRoutes.post('/', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{
    name: string;
    color?: string;
  }>();

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(tags).values({
    id,
    name: body.name,
    color: body.color,
    ownerId: userId,
    createdAt: now,
  });

  const result = await db.query.tags.findFirst({
    where: eq(tags.id, id),
  });

  return c.json({ data: result }, 201);
});

/**
 * Update a tag.
 * PATCH /api/tags/:id
 */
tagRoutes.patch('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    color?: string;
  }>();

  const existing = await db.query.tags.findFirst({
    where: and(eq(tags.id, id), eq(tags.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: 'Tag not found' }, 404);
  }

  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData['name'] = body.name;
  if (body.color !== undefined) updateData['color'] = body.color;

  await db
    .update(tags)
    .set(updateData)
    .where(and(eq(tags.id, id), eq(tags.ownerId, userId)));

  const result = await db.query.tags.findFirst({
    where: eq(tags.id, id),
  });

  return c.json({ data: result });
});

/**
 * Delete a tag.
 * DELETE /api/tags/:id
 */
tagRoutes.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const existing = await db.query.tags.findFirst({
    where: and(eq(tags.id, id), eq(tags.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: 'Tag not found' }, 404);
  }

  await db.delete(tags).where(and(eq(tags.id, id), eq(tags.ownerId, userId)));

  return c.json({ success: true });
});

export { tagRoutes };
