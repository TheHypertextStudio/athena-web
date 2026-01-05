/**
 * Task routes.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { eq, and, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tasks, taskTags, tags } from '../db/schema/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';

const taskRoutes = new Hono();

taskRoutes.use('*', requireAuth);

/**
 * List all tasks for the authenticated user.
 * GET /api/tasks
 */
taskRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  const projectId = c.req.query('projectId');
  const status = c.req.query('status') as
    | 'pending'
    | 'in_progress'
    | 'completed'
    | 'cancelled'
    | undefined;

  let whereClause = or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId));

  if (projectId) {
    whereClause = and(whereClause, eq(tasks.projectId, projectId));
  }

  if (status) {
    whereClause = and(whereClause, eq(tasks.status, status));
  }

  const result = await db.query.tasks.findMany({
    where: whereClause,
    with: {
      project: true,
      assignee: true,
      creator: true,
      tags: {
        with: {
          tag: true,
        },
      },
    },
    orderBy: (tasks, { desc }) => [desc(tasks.createdAt)],
  });

  return c.json({ data: result });
});

/**
 * Get a single task by ID.
 * GET /api/tasks/:id
 */
taskRoutes.get('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const result = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, id), or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId))),
    with: {
      project: {
        with: {
          initiative: true,
        },
      },
      assignee: true,
      creator: true,
      tags: {
        with: {
          tag: true,
        },
      },
    },
  });

  if (!result) {
    return c.json({ error: 'Task not found' }, 404);
  }

  return c.json({ data: result });
});

/**
 * Create a new task.
 * POST /api/tasks
 */
taskRoutes.post('/', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json<{
    title: string;
    description?: string;
    status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    deadline?: string;
    estimatedMinutes?: number;
    projectId?: string;
    assigneeId?: string;
    tagIds?: string[];
  }>();

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(tasks).values({
    id,
    title: body.title,
    description: body.description,
    status: body.status ?? 'pending',
    priority: body.priority ?? 'medium',
    deadline: body.deadline ? new Date(body.deadline) : null,
    estimatedMinutes: body.estimatedMinutes,
    projectId: body.projectId,
    assigneeId: body.assigneeId,
    creatorId: userId,
    createdAt: now,
    updatedAt: now,
  });

  // Add tags if provided
  if (body.tagIds && body.tagIds.length > 0) {
    await db.insert(taskTags).values(
      body.tagIds.map((tagId) => ({
        taskId: id,
        tagId,
      })),
    );
  }

  const result = await db.query.tasks.findFirst({
    where: eq(tasks.id, id),
    with: {
      project: true,
      assignee: true,
      tags: {
        with: {
          tag: true,
        },
      },
    },
  });

  return c.json({ data: result }, 201);
});

/**
 * Update a task.
 * PATCH /api/tasks/:id
 */
taskRoutes.patch('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json<{
    title?: string;
    description?: string;
    status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    deadline?: string | null;
    estimatedMinutes?: number | null;
    projectId?: string | null;
    assigneeId?: string | null;
    tagIds?: string[];
  }>();

  const existing = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, id), or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId))),
  });

  if (!existing) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.title !== undefined) updateData['title'] = body.title;
  if (body.description !== undefined) updateData['description'] = body.description;
  if (body.status !== undefined) updateData['status'] = body.status;
  if (body.priority !== undefined) updateData['priority'] = body.priority;
  if (body.deadline !== undefined) {
    updateData['deadline'] = body.deadline ? new Date(body.deadline) : null;
  }
  if (body.estimatedMinutes !== undefined) updateData['estimatedMinutes'] = body.estimatedMinutes;
  if (body.projectId !== undefined) updateData['projectId'] = body.projectId;
  if (body.assigneeId !== undefined) updateData['assigneeId'] = body.assigneeId;

  await db.update(tasks).set(updateData).where(eq(tasks.id, id));

  // Update tags if provided
  if (body.tagIds !== undefined) {
    await db.delete(taskTags).where(eq(taskTags.taskId, id));
    if (body.tagIds.length > 0) {
      await db.insert(taskTags).values(
        body.tagIds.map((tagId) => ({
          taskId: id,
          tagId,
        })),
      );
    }
  }

  const result = await db.query.tasks.findFirst({
    where: eq(tasks.id, id),
    with: {
      project: true,
      assignee: true,
      tags: {
        with: {
          tag: true,
        },
      },
    },
  });

  return c.json({ data: result });
});

/**
 * Delete a task.
 * DELETE /api/tasks/:id
 */
taskRoutes.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const existing = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, id), eq(tasks.creatorId, userId)),
  });

  if (!existing) {
    return c.json({ error: 'Task not found or not authorized' }, 404);
  }

  await db.delete(tasks).where(eq(tasks.id, id));

  return c.json({ success: true });
});

/**
 * Add a tag to a task.
 * POST /api/tasks/:id/tags/:tagId
 */
taskRoutes.post('/:id/tags/:tagId', async (c) => {
  const userId = getUserId(c);
  const taskId = c.req.param('id');
  const tagId = c.req.param('tagId');

  const task = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, taskId), or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId))),
  });

  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const tag = await db.query.tags.findFirst({
    where: and(eq(tags.id, tagId), eq(tags.ownerId, userId)),
  });

  if (!tag) {
    return c.json({ error: 'Tag not found' }, 404);
  }

  await db.insert(taskTags).values({ taskId, tagId }).onConflictDoNothing();

  return c.json({ success: true });
});

/**
 * Remove a tag from a task.
 * DELETE /api/tasks/:id/tags/:tagId
 */
taskRoutes.delete('/:id/tags/:tagId', async (c) => {
  const userId = getUserId(c);
  const taskId = c.req.param('id');
  const tagId = c.req.param('tagId');

  const task = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, taskId), or(eq(tasks.creatorId, userId), eq(tasks.assigneeId, userId))),
  });

  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }

  await db.delete(taskTags).where(and(eq(taskTags.taskId, taskId), eq(taskTags.tagId, tagId)));

  return c.json({ success: true });
});

export { taskRoutes };
