/**
 * Workspace routes.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workspaces } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { requireEntitlement } from '../middleware/entitlements.js';

const workspaceRoutes = new Hono();

// Require authentication for all routes
workspaceRoutes.use('*', requireAuth);

// Require 'team_workspaces' entitlement for mutating operations (POST/PUT/DELETE)
// GET requests pass through (read access is sacred)
workspaceRoutes.use('*', requireEntitlement('team_workspaces'));

/**
 * List all workspaces for the authenticated user.
 * GET /api/workspaces
 */
workspaceRoutes.get('/', async (c) => {
  const userId = getUserId(c);

  const result = await db.query.workspaces.findMany({
    where: eq(workspaces.ownerId, userId),
    orderBy: (workspaces, { desc }) => [desc(workspaces.createdAt)],
  });

  return c.json({ data: result });
});

/**
 * Get a single workspace by ID.
 * GET /api/workspaces/:id
 */
workspaceRoutes.get('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const result = await db.query.workspaces.findFirst({
    where: and(eq(workspaces.id, id), eq(workspaces.ownerId, userId)),
  });

  if (!result) {
    return c.json({ error: 'Workspace not found' }, 404);
  }

  return c.json({ data: result });
});

/**
 * Create a new workspace.
 * POST /api/workspaces
 */
workspaceRoutes.post('/', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{
    name: string;
    description?: string;
  }>();

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(workspaces).values({
    id,
    name: body.name,
    description: body.description,
    ownerId: userId,
    createdAt: now,
    updatedAt: now,
  });

  const result = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, id),
  });

  return c.json({ data: result }, 201);
});

/**
 * Update a workspace.
 * PATCH /api/workspaces/:id
 */
workspaceRoutes.patch('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    description?: string | null;
  }>();

  const existing = await db.query.workspaces.findFirst({
    where: and(eq(workspaces.id, id), eq(workspaces.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: 'Workspace not found' }, 404);
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;

  await db
    .update(workspaces)
    .set(updateData)
    .where(and(eq(workspaces.id, id), eq(workspaces.ownerId, userId)));

  const result = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, id),
  });

  return c.json({ data: result });
});

/**
 * Delete a workspace.
 * DELETE /api/workspaces/:id
 */
workspaceRoutes.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const existing = await db.query.workspaces.findFirst({
    where: and(eq(workspaces.id, id), eq(workspaces.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: 'Workspace not found' }, 404);
  }

  await db.delete(workspaces).where(and(eq(workspaces.id, id), eq(workspaces.ownerId, userId)));

  return c.body(null, 204);
});

export { workspaceRoutes };
