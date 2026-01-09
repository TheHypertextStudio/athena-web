/**
 * Workspaces API integration tests.
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

describe('Workspaces API', () => {
  beforeEach(() => {
    resetMockDb(mockDb);
  });

  describe('GET /api/workspaces', () => {
    it('should return empty list when no workspaces exist', async () => {
      mockDb.query.workspaces.findMany.mockResolvedValue([]);

      const res = await app.request('/api/workspaces');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toEqual([]);
    });

    it('should return workspaces list', async () => {
      const mockWorkspaces = [
        {
          id: 'workspace-1',
          name: 'Personal',
          description: 'Personal workspace',
          ownerId: 'test-user-id',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'workspace-2',
          name: 'Work',
          description: 'Work workspace',
          ownerId: 'test-user-id',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockDb.query.workspaces.findMany.mockResolvedValue(mockWorkspaces);

      const res = await app.request('/api/workspaces');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockWorkspaces };
      expect(body.data).toHaveLength(2);
      expect(body.data[0]?.name).toBe('Personal');
    });
  });

  describe('GET /api/workspaces/:id', () => {
    it('should return 404 for non-existent workspace', async () => {
      mockDb.query.workspaces.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/workspaces/non-existent');
      expect(res.status).toBe(404);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Workspace not found');
    });

    it('should return workspace by id', async () => {
      const mockWorkspace = {
        id: 'workspace-1',
        name: 'Personal',
        description: 'Personal workspace',
        ownerId: 'test-user-id',
      };
      mockDb.query.workspaces.findFirst.mockResolvedValue(mockWorkspace);

      const res = await app.request('/api/workspaces/workspace-1');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockWorkspace };
      expect(body.data.id).toBe('workspace-1');
      expect(body.data.name).toBe('Personal');
    });
  });

  describe('POST /api/workspaces', () => {
    it('should create a new workspace with name only', async () => {
      const newWorkspace = {
        id: 'new-workspace',
        name: 'New Workspace',
        ownerId: 'test-user-id',
      };
      mockDb.query.workspaces.findFirst.mockResolvedValue(newWorkspace);

      const res = await app.request('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Workspace' }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: typeof newWorkspace };
      expect(body.data.name).toBe('New Workspace');
    });

    it('should create workspace with description', async () => {
      const newWorkspace = {
        id: 'new-workspace',
        name: 'Full Workspace',
        description: 'A workspace with description',
        ownerId: 'test-user-id',
      };
      mockDb.query.workspaces.findFirst.mockResolvedValue(newWorkspace);

      const res = await app.request('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Full Workspace',
          description: 'A workspace with description',
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: typeof newWorkspace };
      expect(body.data.description).toBe('A workspace with description');
    });
  });

  describe('PATCH /api/workspaces/:id', () => {
    it('should return 404 for non-existent workspace', async () => {
      mockDb.query.workspaces.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/workspaces/non-existent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(404);
    });

    it('should update workspace name', async () => {
      const existingWorkspace = { id: 'workspace-1', name: 'Original', ownerId: 'test-user-id' };
      const updatedWorkspace = { id: 'workspace-1', name: 'Updated', ownerId: 'test-user-id' };

      mockDb.query.workspaces.findFirst
        .mockResolvedValueOnce(existingWorkspace)
        .mockResolvedValueOnce(updatedWorkspace);

      const res = await app.request('/api/workspaces/workspace-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { name: string } };
      expect(body.data.name).toBe('Updated');
    });

    it('should update workspace description', async () => {
      const existingWorkspace = { id: 'workspace-1', description: null, ownerId: 'test-user-id' };
      const updatedWorkspace = {
        id: 'workspace-1',
        description: 'New description',
        ownerId: 'test-user-id',
      };

      mockDb.query.workspaces.findFirst
        .mockResolvedValueOnce(existingWorkspace)
        .mockResolvedValueOnce(updatedWorkspace);

      const res = await app.request('/api/workspaces/workspace-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'New description' }),
      });

      expect(res.status).toBe(200);
    });

    it('should clear workspace description with null', async () => {
      const existingWorkspace = {
        id: 'workspace-1',
        description: 'Old desc',
        ownerId: 'test-user-id',
      };
      const updatedWorkspace = {
        id: 'workspace-1',
        description: null,
        ownerId: 'test-user-id',
      };

      mockDb.query.workspaces.findFirst
        .mockResolvedValueOnce(existingWorkspace)
        .mockResolvedValueOnce(updatedWorkspace);

      const res = await app.request('/api/workspaces/workspace-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: null }),
      });

      expect(res.status).toBe(200);
    });

    it('should update multiple fields at once', async () => {
      const existingWorkspace = { id: 'workspace-1', ownerId: 'test-user-id' };
      const updatedWorkspace = {
        id: 'workspace-1',
        name: 'New Name',
        description: 'New Description',
        ownerId: 'test-user-id',
      };

      mockDb.query.workspaces.findFirst
        .mockResolvedValueOnce(existingWorkspace)
        .mockResolvedValueOnce(updatedWorkspace);

      const res = await app.request('/api/workspaces/workspace-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Name',
          description: 'New Description',
        }),
      });

      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/workspaces/:id', () => {
    it('should return 404 for non-existent workspace', async () => {
      mockDb.query.workspaces.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/workspaces/non-existent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });

    it('should delete workspace', async () => {
      mockDb.query.workspaces.findFirst.mockResolvedValue({
        id: 'workspace-1',
        ownerId: 'test-user-id',
      });

      const res = await app.request('/api/workspaces/workspace-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);
    });
  });
});
