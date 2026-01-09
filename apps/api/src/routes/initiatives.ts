/**
 * Initiative routes.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { initiatives } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';

const initiativeRoutes = new Hono();

// All initiative routes require authentication
initiativeRoutes.use('*', requireAuth);

const INITIATIVE_STATUS = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  ARCHIVED: 'archived',
} as const;
type InitiativeStatus = (typeof INITIATIVE_STATUS)[keyof typeof INITIATIVE_STATUS];
const DEFAULT_INITIATIVE_STATUS: InitiativeStatus = INITIATIVE_STATUS.DRAFT;

/**
 * List all initiatives for the authenticated user.
 * GET /api/initiatives
 */
initiativeRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  const status = c.req.query('status') as InitiativeStatus | undefined;
  const parentId = c.req.query('parentId');

  const conditions = [eq(initiatives.ownerId, userId)];

  if (status) {
    conditions.push(eq(initiatives.status, status));
  }

  if (parentId) {
    conditions.push(eq(initiatives.parentId, parentId));
  }

  const result = await db.query.initiatives.findMany({
    where: and(...conditions),
    with: {
      parent: true,
      children: true,
      projects: true,
    },
    orderBy: (initiatives, { desc }) => [desc(initiatives.createdAt)],
  });

  return c.json({ data: result });
});

/**
 * Get a single initiative by ID.
 * GET /api/initiatives/:id
 */
initiativeRoutes.get('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const result = await db.query.initiatives.findFirst({
    where: and(eq(initiatives.id, id), eq(initiatives.ownerId, userId)),
    with: {
      parent: true,
      children: true,
      projects: {
        with: {
          tasks: true,
        },
      },
    },
  });

  if (!result) {
    return c.json({ error: 'Initiative not found' }, 404);
  }

  return c.json({ data: result });
});

/**
 * Create a new initiative.
 * POST /api/initiatives
 */
initiativeRoutes.post('/', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{
    name: string;
    description?: string;
    status?: InitiativeStatus;
    parentId?: string;
  }>();

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(initiatives).values({
    id,
    name: body.name,
    description: body.description,
    status: body.status ?? DEFAULT_INITIATIVE_STATUS,
    parentId: body.parentId,
    ownerId: userId,
    createdAt: now,
    updatedAt: now,
  });

  const result = await db.query.initiatives.findFirst({
    where: eq(initiatives.id, id),
    with: {
      parent: true,
    },
  });

  return c.json({ data: result }, 201);
});

/**
 * Update an initiative.
 * PATCH /api/initiatives/:id
 */
initiativeRoutes.patch('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    description?: string;
    status?: InitiativeStatus;
    parentId?: string | null;
  }>();

  const existing = await db.query.initiatives.findFirst({
    where: and(eq(initiatives.id, id), eq(initiatives.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: 'Initiative not found' }, 404);
  }

  await db
    .update(initiatives)
    .set({
      ...body,
      updatedAt: new Date(),
    })
    .where(and(eq(initiatives.id, id), eq(initiatives.ownerId, userId)));

  const result = await db.query.initiatives.findFirst({
    where: eq(initiatives.id, id),
    with: {
      parent: true,
      children: true,
    },
  });

  return c.json({ data: result });
});

/**
 * Delete an initiative.
 * DELETE /api/initiatives/:id
 */
initiativeRoutes.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const existing = await db.query.initiatives.findFirst({
    where: and(eq(initiatives.id, id), eq(initiatives.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: 'Initiative not found' }, 404);
  }

  await db.delete(initiatives).where(and(eq(initiatives.id, id), eq(initiatives.ownerId, userId)));

  return c.body(null, 204);
});

export { initiativeRoutes };
