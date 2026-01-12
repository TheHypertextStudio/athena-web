/**
 * Project routes.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { projects, projectDependencies } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';

const projectRoutes = new Hono();

projectRoutes.use('*', requireAuth);

const PROJECT_STATUS = {
  PLANNING: 'planning',
  ACTIVE: 'active',
  ON_HOLD: 'on_hold',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;
type ProjectStatus = (typeof PROJECT_STATUS)[keyof typeof PROJECT_STATUS];
const DEFAULT_PROJECT_STATUS: ProjectStatus = PROJECT_STATUS.PLANNING;
const ERROR_PROJECT_NOT_FOUND = 'Project not found';
const ERROR_DEPENDENCY_PROJECT_NOT_FOUND = 'Dependency project not found';
const ERROR_SELF_DEPENDENCY = 'A project cannot depend on itself';
const ERROR_CIRCULAR_DEPENDENCY = 'Circular dependency detected';

/**
 * List all projects for the authenticated user.
 * GET /api/projects
 */
projectRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  const initiativeId = c.req.query('initiativeId');
  const status = c.req.query('status') as ProjectStatus | undefined;

  const conditions = [eq(projects.ownerId, userId)];

  if (initiativeId) {
    conditions.push(eq(projects.initiativeId, initiativeId));
  }

  if (status) {
    conditions.push(eq(projects.status, status));
  }

  const result = await db.query.projects.findMany({
    where: and(...conditions),
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
    return c.json({ error: ERROR_PROJECT_NOT_FOUND }, 404);
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
    status?: ProjectStatus;
    deadline?: string;
    initiativeId?: string;
  }>();

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(projects).values({
    id,
    name: body.name,
    description: body.description,
    status: body.status ?? DEFAULT_PROJECT_STATUS,
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
    status?: ProjectStatus;
    deadline?: string | null;
    initiativeId?: string | null;
  }>();

  const existing = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.ownerId, userId)),
  });

  if (!existing) {
    return c.json({ error: ERROR_PROJECT_NOT_FOUND }, 404);
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.status !== undefined) updateData.status = body.status;
  if (body.deadline !== undefined) {
    updateData.deadline = body.deadline ? new Date(body.deadline) : null;
  }
  if (body.initiativeId !== undefined) updateData.initiativeId = body.initiativeId;

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
    return c.json({ error: ERROR_PROJECT_NOT_FOUND }, 404);
  }

  await db.delete(projects).where(and(eq(projects.id, id), eq(projects.ownerId, userId)));

  return c.body(null, 204);
});

/**
 * Get project dependencies.
 * GET /api/projects/:id/dependencies
 */
projectRoutes.get('/:id/dependencies', async (c) => {
  const userId = getUserId(c);
  const projectId = c.req.param('id');

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, userId)),
  });

  if (!project) {
    return c.json({ error: ERROR_PROJECT_NOT_FOUND }, 404);
  }

  const dependencies = await db.query.projectDependencies.findMany({
    where: eq(projectDependencies.projectId, projectId),
    with: {
      dependsOnProject: true,
    },
  });

  return c.json({
    data: dependencies.map((d) => d.dependsOnProject),
  });
});

/**
 * Add a dependency to a project.
 * POST /api/projects/:id/dependencies/:dependsOnId
 */
projectRoutes.post('/:id/dependencies/:dependsOnId', async (c) => {
  const userId = getUserId(c);
  const projectId = c.req.param('id');
  const dependsOnId = c.req.param('dependsOnId');

  // Prevent self-dependency
  if (projectId === dependsOnId) {
    return c.json({ error: ERROR_SELF_DEPENDENCY }, 400);
  }

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, userId)),
  });

  if (!project) {
    return c.json({ error: ERROR_PROJECT_NOT_FOUND }, 404);
  }

  const dependsOnProject = await db.query.projects.findFirst({
    where: and(eq(projects.id, dependsOnId), eq(projects.ownerId, userId)),
  });

  if (!dependsOnProject) {
    return c.json({ error: ERROR_DEPENDENCY_PROJECT_NOT_FOUND }, 404);
  }

  // Check for circular dependency
  const reverseCheck = await db.query.projectDependencies.findFirst({
    where: and(
      eq(projectDependencies.projectId, dependsOnId),
      eq(projectDependencies.dependsOnProjectId, projectId),
    ),
  });

  if (reverseCheck) {
    return c.json({ error: ERROR_CIRCULAR_DEPENDENCY }, 400);
  }

  const id = crypto.randomUUID();
  await db
    .insert(projectDependencies)
    .values({
      id,
      projectId,
      dependsOnProjectId: dependsOnId,
      createdAt: new Date(),
    })
    .onConflictDoNothing();

  return c.body(null, 201);
});

/**
 * Remove a dependency from a project.
 * DELETE /api/projects/:id/dependencies/:dependsOnId
 */
projectRoutes.delete('/:id/dependencies/:dependsOnId', async (c) => {
  const userId = getUserId(c);
  const projectId = c.req.param('id');
  const dependsOnId = c.req.param('dependsOnId');

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, userId)),
  });

  if (!project) {
    return c.json({ error: ERROR_PROJECT_NOT_FOUND }, 404);
  }

  await db
    .delete(projectDependencies)
    .where(
      and(
        eq(projectDependencies.projectId, projectId),
        eq(projectDependencies.dependsOnProjectId, dependsOnId),
      ),
    );

  return c.body(null, 204);
});

export { projectRoutes };
