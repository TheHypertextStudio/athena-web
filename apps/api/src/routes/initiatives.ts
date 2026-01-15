/**
 * Initiative routes.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { initiatives, customInitiativeStatuses } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';

const initiativeRoutes = new Hono();

// All initiative routes require authentication
initiativeRoutes.use('*', requireAuth);

type InitiativeStatusCategory = 'planning' | 'active' | 'completed' | 'archived';

/**
 * Look up custom status and return its details.
 */
async function getCustomStatus(statusId: string) {
  return db.query.customInitiativeStatuses.findFirst({
    where: eq(customInitiativeStatuses.id, statusId),
  });
}

/**
 * Get the default status for a category (first status marked as default, or first by position).
 */
async function getDefaultStatus(category: InitiativeStatusCategory = 'planning') {
  // First try to find a default status for this category
  let status = await db.query.customInitiativeStatuses.findFirst({
    where: and(
      eq(customInitiativeStatuses.category, category),
      eq(customInitiativeStatuses.isDefault, true),
    ),
  });

  // Fall back to first status in the category by position
  status ??= await db.query.customInitiativeStatuses.findFirst({
    where: eq(customInitiativeStatuses.category, category),
    orderBy: (s, { asc }) => [asc(s.position)],
  });

  return status;
}
const ERROR_INITIATIVE_NOT_FOUND = 'Initiative not found';

/**
 * List all initiatives for the authenticated user.
 * GET /api/initiatives
 *
 * Query params:
 * - category: Filter by status category (planning, active, completed, archived)
 * - statusId: Filter by specific status ID
 * - parentId: Filter by parent initiative
 */
initiativeRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  const category = c.req.query('category') as InitiativeStatusCategory | undefined;
  const statusId = c.req.query('statusId');
  const parentId = c.req.query('parentId');

  const conditions = [eq(initiatives.ownerId, userId)];

  if (category) {
    conditions.push(eq(initiatives.statusCategory, category));
  }

  if (statusId) {
    conditions.push(eq(initiatives.statusId, statusId));
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
      customStatus: true,
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
      customStatus: true,
    },
  });

  if (!result) {
    return c.json({ error: ERROR_INITIATIVE_NOT_FOUND }, 404);
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
    statusId?: string;
    parentId?: string;
  }>();

  const id = crypto.randomUUID();
  const now = new Date();

  // Get status - use provided statusId or default to first planning status
  let customStatus = body.statusId ? await getCustomStatus(body.statusId) : null;
  customStatus ??= await getDefaultStatus('planning');

  if (!customStatus) {
    return c.json({ error: 'No initiative statuses configured' }, 400);
  }

  await db.insert(initiatives).values({
    id,
    name: body.name,
    description: body.description,
    statusId: customStatus.id,
    statusCategory: customStatus.category,
    parentId: body.parentId,
    ownerId: userId,
    createdAt: now,
    updatedAt: now,
  });

  const result = await db.query.initiatives.findFirst({
    where: eq(initiatives.id, id),
    with: {
      parent: true,
      customStatus: true,
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
    description?: string | null;
    statusId?: string;
    parentId?: string | null;
  }>();

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
      return c.json({ error: 'Invalid status ID' }, 400);
    }
    updateData.statusId = customStatus.id;
    updateData.statusCategory = customStatus.category;
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
      customStatus: true,
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
initiativeRoutes.get('/:id/metrics', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

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

  // Aggregate all tasks from all projects
  const allTasks = initiative.projects.flatMap((p) => p.tasks);

  // Task counts
  const taskCounts = {
    total: allTasks.length,
    completed: allTasks.filter((t) => t.status === 'completed').length,
    inProgress: allTasks.filter((t) => t.status === 'in_progress').length,
    pending: allTasks.filter((t) => t.status === 'pending').length,
  };

  // Project stats with health indicators
  const projectStats = initiative.projects.map((project) => {
    const projectTasks = project.tasks;
    const completed = projectTasks.filter((t) => t.status === 'completed').length;
    const total = projectTasks.length;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    // Simple health calculation based on progress
    let health: 'on_track' | 'at_risk' | 'blocked' = 'on_track';
    const pendingTasks = projectTasks.filter((t) => t.status === 'pending').length;
    const hasStaleWork = total > 5 && pendingTasks > total * 0.8; // 80%+ pending
    if (hasStaleWork) {
      health = 'blocked';
    } else if (progress < 25 && total > 5) {
      health = 'at_risk';
    }

    return {
      id: project.id,
      name: project.name,
      totalTasks: total,
      completedTasks: completed,
      progress,
      health,
    };
  });

  // Time statistics
  const estimatedMinutes = allTasks.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0);
  const loggedMinutes = allTasks
    .filter((t) => t.status === 'completed')
    .reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0);
  const remainingMinutes = estimatedMinutes - loggedMinutes;

  // Calculate velocity (tasks completed in the last 4 weeks)
  const now = new Date();
  const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
  const weeklyCompletions: number[] = [0, 0, 0, 0];

  for (const task of allTasks) {
    if (task.status === 'completed') {
      const completedAt = new Date(task.updatedAt);
      if (completedAt >= fourWeeksAgo) {
        const weeksAgo = Math.floor(
          (now.getTime() - completedAt.getTime()) / (7 * 24 * 60 * 60 * 1000),
        );
        if (weeksAgo >= 0 && weeksAgo < 4) {
          const index = 3 - weeksAgo;
          weeklyCompletions[index] = (weeklyCompletions[index] ?? 0) + 1;
        }
      }
    }
  }

  const currentVelocity = weeklyCompletions[3] ?? 0;
  const averageVelocity = weeklyCompletions.reduce((sum, v) => sum + v, 0) / 4;
  const velocityTrend = Math.round((currentVelocity - averageVelocity) * 10) / 10;

  // Projected completion
  let projectedCompletion: string | null = null;
  const remainingTasks = taskCounts.total - taskCounts.completed;
  if (currentVelocity > 0 && remainingTasks > 0) {
    const weeksRemaining = remainingTasks / currentVelocity;
    const daysRemaining = Math.ceil(weeksRemaining * 7);
    const projected = new Date();
    projected.setDate(projected.getDate() + daysRemaining);
    projectedCompletion = projected.toISOString();
  }

  return c.json({
    data: {
      taskCounts,
      projectStats,
      timeStats: {
        estimatedMinutes,
        loggedMinutes,
        remainingMinutes,
      },
      velocity: {
        current: currentVelocity,
        average: Math.round(averageVelocity * 10) / 10,
        trend: velocityTrend,
        weeklyCompletions,
      },
      projectedCompletion,
    },
  });
});

export { initiativeRoutes };
