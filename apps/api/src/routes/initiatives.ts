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
const ERROR_INITIATIVE_NOT_FOUND = 'Initiative not found';

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
    // eslint-disable-next-line @typescript-eslint/no-deprecated
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
    return c.json({ error: ERROR_INITIATIVE_NOT_FOUND }, 404);
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
