/**
 * Initiatives API integration tests.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetMockDb, type MockDb } from './test-utils.js';

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

describe('Initiatives API', () => {
  beforeEach(() => {
    resetMockDb(mockDb);
  });

  describe('GET /api/initiatives', () => {
    it('should return empty list when no initiatives exist', async () => {
      mockDb.query.initiatives.findMany.mockResolvedValue([]);

      const res = await app.request('/api/initiatives');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toEqual([]);
    });

    it('should return initiatives list', async () => {
      const mockInitiatives = [
        {
          id: 'init-1',
          name: 'Test Initiative',
          status: 'active',
          ownerId: 'test-user-id',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockDb.query.initiatives.findMany.mockResolvedValue(mockInitiatives);

      const res = await app.request('/api/initiatives');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockInitiatives };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.name).toBe('Test Initiative');
    });

    it('should filter initiatives by status', async () => {
      mockDb.query.initiatives.findMany.mockResolvedValue([]);

      const res = await app.request('/api/initiatives?status=active');
      expect(res.status).toBe(200);
    });

    it('should filter initiatives by parentId', async () => {
      mockDb.query.initiatives.findMany.mockResolvedValue([]);

      const res = await app.request('/api/initiatives?parentId=parent-init-1');
      expect(res.status).toBe(200);
    });

    it('should combine multiple filters', async () => {
      mockDb.query.initiatives.findMany.mockResolvedValue([]);

      const res = await app.request('/api/initiatives?status=draft&parentId=parent-1');
      expect(res.status).toBe(200);
    });

    it('should return initiatives with relations', async () => {
      const mockInitiatives = [
        {
          id: 'init-1',
          name: 'Initiative with Relations',
          status: 'active',
          ownerId: 'test-user-id',
          parent: { id: 'parent-init', name: 'Parent' },
          children: [{ id: 'child-init', name: 'Child' }],
          projects: [{ id: 'project-1', name: 'Project 1' }],
        },
      ];
      mockDb.query.initiatives.findMany.mockResolvedValue(mockInitiatives);

      const res = await app.request('/api/initiatives');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockInitiatives };
      expect(body.data[0]?.parent.name).toBe('Parent');
      expect(body.data[0]?.children).toHaveLength(1);
      expect(body.data[0]?.projects).toHaveLength(1);
    });
  });

  describe('GET /api/initiatives/:id', () => {
    it('should return 404 for non-existent initiative', async () => {
      mockDb.query.initiatives.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/initiatives/non-existent');
      expect(res.status).toBe(404);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Initiative not found');
    });

    it('should return initiative by id', async () => {
      const mockInitiative = {
        id: 'init-1',
        name: 'Test Initiative',
        status: 'active',
        ownerId: 'test-user-id',
      };
      mockDb.query.initiatives.findFirst.mockResolvedValue(mockInitiative);

      const res = await app.request('/api/initiatives/init-1');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockInitiative };
      expect(body.data.id).toBe('init-1');
      expect(body.data.name).toBe('Test Initiative');
    });

    it('should return initiative with full relations', async () => {
      const mockInitiative = {
        id: 'init-1',
        name: 'Full Initiative',
        status: 'active',
        ownerId: 'test-user-id',
        parent: { id: 'parent-init', name: 'Parent Initiative' },
        children: [{ id: 'child-1', name: 'Child 1' }],
        projects: [
          {
            id: 'project-1',
            name: 'Project',
            tasks: [{ id: 'task-1', title: 'Task 1' }],
          },
        ],
      };
      mockDb.query.initiatives.findFirst.mockResolvedValue(mockInitiative);

      const res = await app.request('/api/initiatives/init-1');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockInitiative };
      expect(body.data.projects[0]?.tasks).toHaveLength(1);
    });
  });

  describe('POST /api/initiatives', () => {
    it('should create a new initiative with minimal fields', async () => {
      const newInitiative = {
        id: 'new-init',
        name: 'New Initiative',
        status: 'draft',
        ownerId: 'test-user-id',
      };
      mockDb.query.initiatives.findFirst.mockResolvedValue(newInitiative);

      const res = await app.request('/api/initiatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Initiative' }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: typeof newInitiative };
      expect(body.data.name).toBe('New Initiative');
    });

    it('should create initiative with all optional fields', async () => {
      const newInitiative = {
        id: 'new-init',
        name: 'Full Initiative',
        description: 'An initiative description',
        status: 'active',
        parentId: 'parent-init',
        ownerId: 'test-user-id',
      };
      mockDb.query.initiatives.findFirst.mockResolvedValue(newInitiative);

      const res = await app.request('/api/initiatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Full Initiative',
          description: 'An initiative description',
          status: 'active',
          parentId: 'parent-init',
        }),
      });

      expect(res.status).toBe(201);
    });

    it('should handle draft status', async () => {
      const newInitiative = {
        id: 'new-init',
        name: 'Draft Initiative',
        status: 'draft',
        ownerId: 'test-user-id',
      };
      mockDb.query.initiatives.findFirst.mockResolvedValue(newInitiative);

      const res = await app.request('/api/initiatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Draft Initiative', status: 'draft' }),
      });

      expect(res.status).toBe(201);
    });

    it('should handle completed status', async () => {
      const newInitiative = {
        id: 'new-init',
        name: 'Completed Initiative',
        status: 'completed',
        ownerId: 'test-user-id',
      };
      mockDb.query.initiatives.findFirst.mockResolvedValue(newInitiative);

      const res = await app.request('/api/initiatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Completed Initiative', status: 'completed' }),
      });

      expect(res.status).toBe(201);
    });

    it('should handle archived status', async () => {
      const newInitiative = {
        id: 'new-init',
        name: 'Archived Initiative',
        status: 'archived',
        ownerId: 'test-user-id',
      };
      mockDb.query.initiatives.findFirst.mockResolvedValue(newInitiative);

      const res = await app.request('/api/initiatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Archived Initiative', status: 'archived' }),
      });

      expect(res.status).toBe(201);
    });
  });

  describe('PATCH /api/initiatives/:id', () => {
    it('should return 404 for non-existent initiative', async () => {
      mockDb.query.initiatives.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/initiatives/non-existent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(404);
    });

    it('should update initiative name', async () => {
      const existingInit = { id: 'init-1', name: 'Original', ownerId: 'test-user-id' };
      const updatedInit = { id: 'init-1', name: 'Updated', ownerId: 'test-user-id' };

      mockDb.query.initiatives.findFirst
        .mockResolvedValueOnce(existingInit)
        .mockResolvedValueOnce(updatedInit);

      const res = await app.request('/api/initiatives/init-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { name: string } };
      expect(body.data.name).toBe('Updated');
    });

    it('should update initiative status', async () => {
      const existingInit = { id: 'init-1', status: 'draft', ownerId: 'test-user-id' };
      const updatedInit = { id: 'init-1', status: 'active', ownerId: 'test-user-id' };

      mockDb.query.initiatives.findFirst
        .mockResolvedValueOnce(existingInit)
        .mockResolvedValueOnce(updatedInit);

      const res = await app.request('/api/initiatives/init-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });

      expect(res.status).toBe(200);
    });

    it('should update initiative description', async () => {
      const existingInit = { id: 'init-1', description: null, ownerId: 'test-user-id' };
      const updatedInit = {
        id: 'init-1',
        description: 'New description',
        ownerId: 'test-user-id',
      };

      mockDb.query.initiatives.findFirst
        .mockResolvedValueOnce(existingInit)
        .mockResolvedValueOnce(updatedInit);

      const res = await app.request('/api/initiatives/init-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'New description' }),
      });

      expect(res.status).toBe(200);
    });

    it('should update initiative parentId', async () => {
      const existingInit = { id: 'init-1', parentId: null, ownerId: 'test-user-id' };
      const updatedInit = {
        id: 'init-1',
        parentId: 'parent-init',
        ownerId: 'test-user-id',
      };

      mockDb.query.initiatives.findFirst
        .mockResolvedValueOnce(existingInit)
        .mockResolvedValueOnce(updatedInit);

      const res = await app.request('/api/initiatives/init-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: 'parent-init' }),
      });

      expect(res.status).toBe(200);
    });

    it('should clear initiative parentId with null', async () => {
      const existingInit = {
        id: 'init-1',
        parentId: 'parent-init',
        ownerId: 'test-user-id',
      };
      const updatedInit = { id: 'init-1', parentId: null, ownerId: 'test-user-id' };

      mockDb.query.initiatives.findFirst
        .mockResolvedValueOnce(existingInit)
        .mockResolvedValueOnce(updatedInit);

      const res = await app.request('/api/initiatives/init-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: null }),
      });

      expect(res.status).toBe(200);
    });

    it('should update multiple fields at once', async () => {
      const existingInit = { id: 'init-1', ownerId: 'test-user-id' };
      const updatedInit = {
        id: 'init-1',
        name: 'Updated',
        status: 'completed',
        description: 'Done',
        ownerId: 'test-user-id',
      };

      mockDb.query.initiatives.findFirst
        .mockResolvedValueOnce(existingInit)
        .mockResolvedValueOnce(updatedInit);

      const res = await app.request('/api/initiatives/init-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Updated',
          status: 'completed',
          description: 'Done',
        }),
      });

      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/initiatives/:id', () => {
    it('should return 404 for non-existent initiative', async () => {
      mockDb.query.initiatives.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/initiatives/non-existent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });

    it('should delete initiative', async () => {
      mockDb.query.initiatives.findFirst.mockResolvedValue({
        id: 'init-1',
        ownerId: 'test-user-id',
      });

      const res = await app.request('/api/initiatives/init-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);
    });
  });
});
