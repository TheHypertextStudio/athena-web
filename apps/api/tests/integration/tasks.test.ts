/**
 * Tasks API integration tests.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetMockDb, type MockDb } from './test-utils.js';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID_2 = '22222222-2222-4222-8222-222222222222';
const TASK_ID_3 = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const TAG_ID = '55555555-5555-4555-8555-555555555555';
const TAG_ID_2 = '66666666-6666-4666-8666-666666666666';
const NEW_TASK_ID = '77777777-7777-4777-8777-777777777777';

const mockDb = vi.hoisted(() => {
  const factory = (globalThis as { __athenaMockDbFactory?: () => MockDb }).__athenaMockDbFactory;
  if (!factory) {
    throw new Error('Mock DB factory not initialized');
  }
  return factory();
});

vi.mock('../../src/db/index.js', () => ({ db: mockDb }));

vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: async (
    _c: { set: (key: string, value: unknown) => void },
    next: () => Promise<void>,
  ) => {
    _c.set('userId', 'test-user-id');
    await next();
  },
  getUserId: (c: { get: (key: string) => unknown }) => c.get('userId') ?? 'test-user-id',
}));

vi.mock('../../src/lib/auth.js', () => ({
  auth: {
    api: { getSession: () => null },
    handler: () => new Response(),
  },
}));

import { app } from '../../src/index.js';

describe('Tasks API', () => {
  beforeEach(() => {
    resetMockDb(mockDb);
  });

  describe('GET /api/tasks', () => {
    it('should return empty list when no tasks exist', async () => {
      mockDb.query.tasks.findMany.mockResolvedValue([]);

      const res = await app.request('/api/tasks');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toEqual([]);
    });

    it('should return tasks list', async () => {
      const mockTasks = [
        {
          id: TASK_ID,
          title: 'Test Task',
          status: 'pending',
          priority: 'medium',
          creatorId: 'test-user-id',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockDb.query.tasks.findMany.mockResolvedValue(mockTasks);

      const res = await app.request('/api/tasks');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockTasks };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.title).toBe('Test Task');
    });

    it('should filter tasks by status', async () => {
      mockDb.query.tasks.findMany.mockResolvedValue([]);

      const res = await app.request('/api/tasks?status=completed');
      expect(res.status).toBe(200);
    });

    it('should filter tasks by projectId', async () => {
      mockDb.query.tasks.findMany.mockResolvedValue([]);

      const res = await app.request(`/api/tasks?projectId=${PROJECT_ID}`);
      expect(res.status).toBe(200);
    });

    it('should filter tasks by priority', async () => {
      mockDb.query.tasks.findMany.mockResolvedValue([]);

      const res = await app.request('/api/tasks?priority=high');
      expect(res.status).toBe(200);
    });

    it('should combine multiple filters', async () => {
      mockDb.query.tasks.findMany.mockResolvedValue([]);

      const res = await app.request(
        `/api/tasks?status=pending&priority=high&projectId=${PROJECT_ID}`,
      );
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/tasks/:id', () => {
    it('should return 404 for non-existent task', async () => {
      mockDb.query.tasks.findFirst.mockResolvedValue(null);

      const res = await app.request(`/api/tasks/${TASK_ID_3}`);
      expect(res.status).toBe(404);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Task not found');
    });

    it('should return task by id', async () => {
      const mockTask = {
        id: TASK_ID,
        title: 'Test Task',
        status: 'pending',
        priority: 'medium',
        creatorId: 'test-user-id',
      };
      mockDb.query.tasks.findFirst.mockResolvedValue(mockTask);

      const res = await app.request(`/api/tasks/${TASK_ID}`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockTask };
      expect(body.data.id).toBe(TASK_ID);
      expect(body.data.title).toBe('Test Task');
    });
  });

  describe('POST /api/tasks', () => {
    it('should create a new task with minimal fields', async () => {
      const newTask = {
        id: NEW_TASK_ID,
        title: 'New Task',
        status: 'pending',
        priority: 'medium',
        creatorId: 'test-user-id',
      };
      mockDb.query.tasks.findFirst.mockResolvedValue(newTask);

      const res = await app.request('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Task' }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: typeof newTask };
      expect(body.data.title).toBe('New Task');
    });

    it('should create task with all optional fields', async () => {
      const newTask = {
        id: NEW_TASK_ID,
        title: 'Full Task',
        description: 'A task description',
        status: 'in_progress',
        priority: 'high',
        projectId: PROJECT_ID,
        deadline: new Date('2026-12-31'),
        estimatedMinutes: 60,
        creatorId: 'test-user-id',
      };
      mockDb.query.tasks.findFirst.mockResolvedValue(newTask);

      const res = await app.request('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Full Task',
          description: 'A task description',
          status: 'in_progress',
          priority: 'high',
          projectId: PROJECT_ID,
          deadline: '2026-12-31T00:00:00Z',
          estimatedMinutes: 60,
        }),
      });

      expect(res.status).toBe(201);
    });
  });

  describe('PATCH /api/tasks/:id', () => {
    it('should return 404 for non-existent task', async () => {
      mockDb.query.tasks.findFirst.mockResolvedValue(null);

      const res = await app.request(`/api/tasks/${TASK_ID_3}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated' }),
      });

      expect(res.status).toBe(404);
    });

    it('should update task title', async () => {
      const existingTask = { id: TASK_ID, title: 'Original', creatorId: 'test-user-id' };
      const updatedTask = { id: TASK_ID, title: 'Updated', creatorId: 'test-user-id' };

      mockDb.query.tasks.findFirst
        .mockResolvedValueOnce(existingTask)
        .mockResolvedValueOnce(updatedTask);

      const res = await app.request(`/api/tasks/${TASK_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { title: string } };
      expect(body.data.title).toBe('Updated');
    });

    it('should update task status', async () => {
      const existingTask = { id: TASK_ID, status: 'pending', creatorId: 'test-user-id' };
      const updatedTask = { id: TASK_ID, status: 'completed', creatorId: 'test-user-id' };

      mockDb.query.tasks.findFirst
        .mockResolvedValueOnce(existingTask)
        .mockResolvedValueOnce(updatedTask);

      const res = await app.request(`/api/tasks/${TASK_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });

      expect(res.status).toBe(200);
    });

    it('should update task priority', async () => {
      const existingTask = { id: TASK_ID, priority: 'low', creatorId: 'test-user-id' };
      const updatedTask = { id: TASK_ID, priority: 'high', creatorId: 'test-user-id' };

      mockDb.query.tasks.findFirst
        .mockResolvedValueOnce(existingTask)
        .mockResolvedValueOnce(updatedTask);

      const res = await app.request(`/api/tasks/${TASK_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: 'high' }),
      });

      expect(res.status).toBe(200);
    });

    it('should update multiple fields at once', async () => {
      const existingTask = { id: TASK_ID, creatorId: 'test-user-id' };
      const updatedTask = {
        id: TASK_ID,
        title: 'Updated',
        status: 'in_progress',
        priority: 'high',
        creatorId: 'test-user-id',
      };

      mockDb.query.tasks.findFirst
        .mockResolvedValueOnce(existingTask)
        .mockResolvedValueOnce(updatedTask);

      const res = await app.request(`/api/tasks/${TASK_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Updated',
          status: 'in_progress',
          priority: 'high',
        }),
      });

      expect(res.status).toBe(200);
    });

    it('should update deadline to a new date', async () => {
      const existingTask = { id: TASK_ID, deadline: null, creatorId: 'test-user-id' };
      const updatedTask = {
        id: TASK_ID,
        deadline: new Date('2026-12-31'),
        creatorId: 'test-user-id',
      };

      mockDb.query.tasks.findFirst
        .mockResolvedValueOnce(existingTask)
        .mockResolvedValueOnce(updatedTask);

      const res = await app.request(`/api/tasks/${TASK_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deadline: '2026-12-31T00:00:00Z' }),
      });

      expect(res.status).toBe(200);
    });

    it('should clear deadline with null', async () => {
      const existingTask = {
        id: TASK_ID,
        deadline: new Date(),
        creatorId: 'test-user-id',
      };
      const updatedTask = { id: TASK_ID, deadline: null, creatorId: 'test-user-id' };

      mockDb.query.tasks.findFirst
        .mockResolvedValueOnce(existingTask)
        .mockResolvedValueOnce(updatedTask);

      const res = await app.request(`/api/tasks/${TASK_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deadline: null }),
      });

      expect(res.status).toBe(200);
    });

    it('should update tags to new set', async () => {
      const existingTask = { id: TASK_ID, creatorId: 'test-user-id' };
      const updatedTask = {
        id: TASK_ID,
        creatorId: 'test-user-id',
        tags: [{ tag: { id: TAG_ID_2, name: 'work' } }],
      };

      mockDb.query.tasks.findFirst
        .mockResolvedValueOnce(existingTask)
        .mockResolvedValueOnce(updatedTask);

      const res = await app.request(`/api/tasks/${TASK_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagIds: [TAG_ID_2] }),
      });

      expect(res.status).toBe(200);
    });

    it('should clear all tags with empty array', async () => {
      const existingTask = {
        id: TASK_ID,
        creatorId: 'test-user-id',
        tags: [{ tag: { id: TAG_ID } }],
      };
      const updatedTask = { id: TASK_ID, creatorId: 'test-user-id', tags: [] };

      mockDb.query.tasks.findFirst
        .mockResolvedValueOnce(existingTask)
        .mockResolvedValueOnce(updatedTask);

      const res = await app.request(`/api/tasks/${TASK_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagIds: [] }),
      });

      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/tasks/:id', () => {
    it('should return 404 for non-existent task', async () => {
      mockDb.query.tasks.findFirst.mockResolvedValue(null);

      const res = await app.request(`/api/tasks/${TASK_ID_3}`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });

    it('should delete task', async () => {
      mockDb.query.tasks.findFirst.mockResolvedValue({
        id: TASK_ID,
        creatorId: 'test-user-id',
      });

      const res = await app.request(`/api/tasks/${TASK_ID}`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);
    });
  });

  describe('POST /api/tasks/:id/tags/:tagId', () => {
    it('should return 404 for non-existent task', async () => {
      mockDb.query.tasks.findFirst.mockResolvedValue(null);

      const res = await app.request(`/api/tasks/${TASK_ID_3}/tags/${TAG_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Task not found');
    });

    it('should return 404 for non-existent tag', async () => {
      mockDb.query.tasks.findFirst.mockResolvedValue({
        id: TASK_ID,
        creatorId: 'test-user-id',
      });
      mockDb.query.tags.findFirst.mockResolvedValue(null);

      const res = await app.request(`/api/tasks/${TASK_ID}/tags/${TAG_ID_2}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Tag not found');
    });

    it('should add tag to task', async () => {
      mockDb.query.tasks.findFirst.mockResolvedValue({
        id: TASK_ID,
        creatorId: 'test-user-id',
      });
      mockDb.query.tags.findFirst.mockResolvedValue({
        id: TAG_ID,
        name: 'urgent',
        ownerId: 'test-user-id',
      });

      const res = await app.request(`/api/tasks/${TASK_ID}/tags/${TAG_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(201);
    });
  });

  describe('DELETE /api/tasks/:id/tags/:tagId', () => {
    it('should return 404 for non-existent task', async () => {
      mockDb.query.tasks.findFirst.mockResolvedValue(null);

      const res = await app.request(`/api/tasks/${TASK_ID_3}/tags/${TAG_ID}`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Task not found');
    });

    it('should remove tag from task', async () => {
      mockDb.query.tasks.findFirst.mockResolvedValue({
        id: TASK_ID,
        creatorId: 'test-user-id',
      });

      const res = await app.request(`/api/tasks/${TASK_ID}/tags/${TAG_ID}`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);
    });
  });

  describe('GET /api/tasks/:id/dependencies', () => {
    it('should return 404 for non-existent task', async () => {
      mockDb.query.tasks.findFirst.mockResolvedValue(null);

      const res = await app.request(`/api/tasks/${TASK_ID_3}/dependencies`);
      expect(res.status).toBe(404);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Task not found');
    });

    it('should return empty dependencies list', async () => {
      mockDb.query.tasks.findFirst.mockResolvedValue({
        id: TASK_ID,
        creatorId: 'test-user-id',
      });
      mockDb.query.taskDependencies.findMany.mockResolvedValue([]);

      const res = await app.request(`/api/tasks/${TASK_ID}/dependencies`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toEqual([]);
    });

    it('should return task dependencies', async () => {
      mockDb.query.tasks.findFirst.mockResolvedValue({
        id: TASK_ID,
        creatorId: 'test-user-id',
      });
      mockDb.query.taskDependencies.findMany.mockResolvedValue([
        {
          id: 'dep-1',
          taskId: TASK_ID,
          dependsOnTaskId: TASK_ID_2,
          dependsOnTask: { id: TASK_ID_2, title: 'Dependency Task' },
        },
      ]);

      const res = await app.request(`/api/tasks/${TASK_ID}/dependencies`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: { id: string; title: string }[] };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.id).toBe(TASK_ID_2);
    });
  });

  describe('POST /api/tasks/:id/dependencies/:dependsOnId', () => {
    it('should return 400 for self-dependency', async () => {
      const res = await app.request(`/api/tasks/${TASK_ID}/dependencies/${TASK_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('A task cannot depend on itself');
    });

    it('should return 404 for non-existent task', async () => {
      mockDb.query.tasks.findFirst.mockResolvedValue(null);

      const res = await app.request(`/api/tasks/${TASK_ID_3}/dependencies/${TASK_ID_2}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Task not found');
    });

    it('should return 404 for non-existent dependency task', async () => {
      mockDb.query.tasks.findFirst
        .mockResolvedValueOnce({ id: TASK_ID, creatorId: 'test-user-id' })
        .mockResolvedValueOnce(null);

      const res = await app.request(`/api/tasks/${TASK_ID}/dependencies/${TASK_ID_3}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Dependency task not found');
    });

    it('should return 400 for circular dependency', async () => {
      mockDb.query.tasks.findFirst
        .mockResolvedValueOnce({ id: TASK_ID, creatorId: 'test-user-id' })
        .mockResolvedValueOnce({ id: TASK_ID_2, creatorId: 'test-user-id' });
      mockDb.query.taskDependencies.findFirst.mockResolvedValue({
        id: 'existing-dep',
        taskId: TASK_ID_2,
        dependsOnTaskId: TASK_ID,
      });

      const res = await app.request(`/api/tasks/${TASK_ID}/dependencies/${TASK_ID_2}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Circular dependency detected');
    });

    it('should add dependency', async () => {
      mockDb.query.tasks.findFirst
        .mockResolvedValueOnce({ id: TASK_ID, creatorId: 'test-user-id' })
        .mockResolvedValueOnce({ id: TASK_ID_2, creatorId: 'test-user-id' });
      mockDb.query.taskDependencies.findFirst.mockResolvedValue(null);

      const res = await app.request(`/api/tasks/${TASK_ID}/dependencies/${TASK_ID_2}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(201);
    });
  });

  describe('DELETE /api/tasks/:id/dependencies/:dependsOnId', () => {
    it('should return 404 for non-existent task', async () => {
      mockDb.query.tasks.findFirst.mockResolvedValue(null);

      const res = await app.request(`/api/tasks/${TASK_ID_3}/dependencies/${TASK_ID_2}`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Task not found');
    });

    it('should remove dependency', async () => {
      mockDb.query.tasks.findFirst.mockResolvedValue({
        id: TASK_ID,
        creatorId: 'test-user-id',
      });

      const res = await app.request(`/api/tasks/${TASK_ID}/dependencies/${TASK_ID_2}`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);
    });
  });
});
