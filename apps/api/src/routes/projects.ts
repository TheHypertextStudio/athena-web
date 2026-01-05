/**
 * Project routes.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { projects } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';

const projectRoutes = new Hono();

projectRoutes.use('*', requireAuth);

/**
 * List all projects for the authenticated user.
 * GET /api/projects
 */
projectRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  const initiativeId = c.req.query('initiativeId');

  const whereClause = initiativeId
    ? and(eq(projects.ownerId, userId), eq(projects.initiativeId, initiativeId))
    : eq(projects.ownerId, userId);

  const result = await db.query.projects.findMany({
    where: whereClause,
    with: {
      initiative: true,
      tasks: true,
    },
    orderBy: (projects, { desc }) => [desc(projects.createdAt)],
  });

  return c.json({ data: result });
});

/**
 * Get a single project by ID.
 * GET /api/projects/:id
 */
projectRoutes.get('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const result = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.ownerId, userId)),
    with: {
      initiative: true,
      tasks: {
        with: {
          assignee: true,
          tags: {
            with: {
              tag: true,
            },
          },
        },
      },
    },
  });

  if (!result) {
    return c.json({ error: 'Project not found' }, 404);
  }

  return c.json({ data: result });
});

/**
 * Create a new project.
 * POST /api/projects
 */
projectRoutes.post('/', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{
    name: string;
    description?: string;
    status?: 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled';
    deadline?: string;
    initiativeId?: string;
  }>();

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(projects).values({
    id,
    name: body.name,
    description: body.description,
    status: body.status ?? 'planning',
    deadline: body.deadline ? new Date(body.deadline) : null,
    initiativeId: body.initiativeId,
    ownerId: userId,
    createdAt: now,
    updatedAt: now,
  });

  const result = await db.query.projects.findFirst({
    where: eq(projects.id, id),
    with: {
      initiative: true,
    },
  });

  return c.json({ data: result }, 201);
});

/**
 * Update a project.
 * PATCH /api/projects/:id
 */
projectRoutes.patch('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    description?: string;
    status?: 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled';
    deadline?: string | null;
    initiativeId?: string | null;
  }>();

  const existing = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updateData['name'] = body.name;
  if (body.description !== undefined) updateData['description'] = body.description;
  if (body.status !== undefined) updateData['status'] = body.status;
  if (body.deadline !== undefined) {
    updateData['deadline'] = body.deadline ? new Date(body.deadline) : null;
  }
  if (body.initiativeId !== undefined) updateData['initiativeId'] = body.initiativeId;

  await db
    .update(projects)
    .set(updateData)
    .where(and(eq(projects.id, id), eq(projects.ownerId, userId)));

  const result = await db.query.projects.findFirst({
    where: eq(projects.id, id),
    with: {
      initiative: true,
    },
  });

  return c.json({ data: result });
});

/**
 * Delete a project.
 * DELETE /api/projects/:id
 */
projectRoutes.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const existing = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: 'Project not found' }, 404);
  }

  await db.delete(projects).where(and(eq(projects.id, id), eq(projects.ownerId, userId)));

  return c.json({ success: true });
});

export { projectRoutes };
