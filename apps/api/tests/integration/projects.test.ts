/**
 * Projects API integration tests.
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

describe('Projects API', () => {
  beforeEach(() => {
    resetMockDb(mockDb);
  });

  describe('GET /api/projects', () => {
    it('should return empty list when no projects exist', async () => {
      mockDb.query.projects.findMany.mockResolvedValue([]);

      const res = await app.request('/api/projects');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toEqual([]);
    });

    it('should return projects list', async () => {
      const mockProjects = [
        {
          id: 'project-1',
          name: 'Test Project',
          status: 'active',
          ownerId: 'test-user-id',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockDb.query.projects.findMany.mockResolvedValue(mockProjects);

      const res = await app.request('/api/projects');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockProjects };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.name).toBe('Test Project');
    });

    it('should filter projects by status', async () => {
      mockDb.query.projects.findMany.mockResolvedValue([]);

      const res = await app.request('/api/projects?status=active');
      expect(res.status).toBe(200);
    });

    it('should filter projects by initiativeId', async () => {
      mockDb.query.projects.findMany.mockResolvedValue([]);

      const res = await app.request('/api/projects?initiativeId=initiative-1');
      expect(res.status).toBe(200);
    });

    it('should combine multiple filters', async () => {
      mockDb.query.projects.findMany.mockResolvedValue([]);

      const res = await app.request('/api/projects?status=planning&initiativeId=init-1');
      expect(res.status).toBe(200);
    });

    it('should return projects with initiative and tasks relations', async () => {
      const mockProjects = [
        {
          id: 'project-1',
          name: 'Project with Relations',
          status: 'active',
          ownerId: 'test-user-id',
          initiative: { id: 'init-1', name: 'Parent Initiative' },
          tasks: [{ id: 'task-1', title: 'Task 1' }],
        },
      ];
      mockDb.query.projects.findMany.mockResolvedValue(mockProjects);

      const res = await app.request('/api/projects');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockProjects };
      expect(body.data[0]?.initiative.name).toBe('Parent Initiative');
      expect(body.data[0]?.tasks).toHaveLength(1);
    });
  });

  describe('GET /api/projects/:id', () => {
    it('should return 404 for non-existent project', async () => {
      mockDb.query.projects.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/projects/non-existent');
      expect(res.status).toBe(404);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Project not found');
    });

    it('should return project by id', async () => {
      const mockProject = {
        id: 'project-1',
        name: 'Test Project',
        status: 'active',
        ownerId: 'test-user-id',
      };
      mockDb.query.projects.findFirst.mockResolvedValue(mockProject);

      const res = await app.request('/api/projects/project-1');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockProject };
      expect(body.data.id).toBe('project-1');
      expect(body.data.name).toBe('Test Project');
    });

    it('should return project with full relations', async () => {
      const mockProject = {
        id: 'project-1',
        name: 'Full Project',
        status: 'active',
        ownerId: 'test-user-id',
        initiative: { id: 'init-1', name: 'Initiative' },
        tasks: [
          {
            id: 'task-1',
            title: 'Task 1',
            assignee: { id: 'user-1', name: 'Assignee' },
            tags: [{ tag: { id: 'tag-1', name: 'urgent' } }],
          },
        ],
      };
      mockDb.query.projects.findFirst.mockResolvedValue(mockProject);

      const res = await app.request('/api/projects/project-1');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockProject };
      expect(body.data.tasks[0]?.assignee.name).toBe('Assignee');
    });
  });

  describe('POST /api/projects', () => {
    it('should create a new project with minimal fields', async () => {
      const newProject = {
        id: 'new-project',
        name: 'New Project',
        status: 'planning',
        ownerId: 'test-user-id',
      };
      mockDb.query.projects.findFirst.mockResolvedValue(newProject);

      const res = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Project' }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: typeof newProject };
      expect(body.data.name).toBe('New Project');
    });

    it('should create project with all optional fields', async () => {
      const newProject = {
        id: 'new-project',
        name: 'Full Project',
        description: 'A project description',
        status: 'active',
        initiativeId: 'initiative-1',
        deadline: new Date('2026-12-31'),
        ownerId: 'test-user-id',
      };
      mockDb.query.projects.findFirst.mockResolvedValue(newProject);

      const res = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Full Project',
          description: 'A project description',
          status: 'active',
          initiativeId: 'initiative-1',
          deadline: '2026-12-31T00:00:00Z',
        }),
      });

      expect(res.status).toBe(201);
    });

    it('should handle on_hold status', async () => {
      const newProject = {
        id: 'new-project',
        name: 'On Hold Project',
        status: 'on_hold',
        ownerId: 'test-user-id',
      };
      mockDb.query.projects.findFirst.mockResolvedValue(newProject);

      const res = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'On Hold Project', status: 'on_hold' }),
      });

      expect(res.status).toBe(201);
    });

    it('should handle completed status', async () => {
      const newProject = {
        id: 'new-project',
        name: 'Completed Project',
        status: 'completed',
        ownerId: 'test-user-id',
      };
      mockDb.query.projects.findFirst.mockResolvedValue(newProject);

      const res = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Completed Project', status: 'completed' }),
      });

      expect(res.status).toBe(201);
    });

    it('should handle cancelled status', async () => {
      const newProject = {
        id: 'new-project',
        name: 'Cancelled Project',
        status: 'cancelled',
        ownerId: 'test-user-id',
      };
      mockDb.query.projects.findFirst.mockResolvedValue(newProject);

      const res = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Cancelled Project', status: 'cancelled' }),
      });

      expect(res.status).toBe(201);
    });
  });

  describe('PATCH /api/projects/:id', () => {
    it('should return 404 for non-existent project', async () => {
      mockDb.query.projects.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/projects/non-existent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(404);
    });

    it('should update project name', async () => {
      const existingProject = { id: 'project-1', name: 'Original', ownerId: 'test-user-id' };
      const updatedProject = { id: 'project-1', name: 'Updated', ownerId: 'test-user-id' };

      mockDb.query.projects.findFirst
        .mockResolvedValueOnce(existingProject)
        .mockResolvedValueOnce(updatedProject);

      const res = await app.request('/api/projects/project-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { name: string } };
      expect(body.data.name).toBe('Updated');
    });

    it('should update project status', async () => {
      const existingProject = { id: 'project-1', status: 'planning', ownerId: 'test-user-id' };
      const updatedProject = { id: 'project-1', status: 'active', ownerId: 'test-user-id' };

      mockDb.query.projects.findFirst
        .mockResolvedValueOnce(existingProject)
        .mockResolvedValueOnce(updatedProject);

      const res = await app.request('/api/projects/project-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });

      expect(res.status).toBe(200);
    });

    it('should update project description', async () => {
      const existingProject = { id: 'project-1', description: null, ownerId: 'test-user-id' };
      const updatedProject = {
        id: 'project-1',
        description: 'New description',
        ownerId: 'test-user-id',
      };

      mockDb.query.projects.findFirst
        .mockResolvedValueOnce(existingProject)
        .mockResolvedValueOnce(updatedProject);

      const res = await app.request('/api/projects/project-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'New description' }),
      });

      expect(res.status).toBe(200);
    });

    it('should update project deadline', async () => {
      const existingProject = { id: 'project-1', deadline: null, ownerId: 'test-user-id' };
      const updatedProject = {
        id: 'project-1',
        deadline: new Date('2026-12-31'),
        ownerId: 'test-user-id',
      };

      mockDb.query.projects.findFirst
        .mockResolvedValueOnce(existingProject)
        .mockResolvedValueOnce(updatedProject);

      const res = await app.request('/api/projects/project-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deadline: '2026-12-31T00:00:00Z' }),
      });

      expect(res.status).toBe(200);
    });

    it('should clear project deadline with null', async () => {
      const existingProject = {
        id: 'project-1',
        deadline: new Date(),
        ownerId: 'test-user-id',
      };
      const updatedProject = { id: 'project-1', deadline: null, ownerId: 'test-user-id' };

      mockDb.query.projects.findFirst
        .mockResolvedValueOnce(existingProject)
        .mockResolvedValueOnce(updatedProject);

      const res = await app.request('/api/projects/project-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deadline: null }),
      });

      expect(res.status).toBe(200);
    });

    it('should update project initiativeId', async () => {
      const existingProject = { id: 'project-1', initiativeId: null, ownerId: 'test-user-id' };
      const updatedProject = {
        id: 'project-1',
        initiativeId: 'init-1',
        ownerId: 'test-user-id',
      };

      mockDb.query.projects.findFirst
        .mockResolvedValueOnce(existingProject)
        .mockResolvedValueOnce(updatedProject);

      const res = await app.request('/api/projects/project-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initiativeId: 'init-1' }),
      });

      expect(res.status).toBe(200);
    });

    it('should clear project initiativeId with null', async () => {
      const existingProject = {
        id: 'project-1',
        initiativeId: 'init-1',
        ownerId: 'test-user-id',
      };
      const updatedProject = { id: 'project-1', initiativeId: null, ownerId: 'test-user-id' };

      mockDb.query.projects.findFirst
        .mockResolvedValueOnce(existingProject)
        .mockResolvedValueOnce(updatedProject);

      const res = await app.request('/api/projects/project-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initiativeId: null }),
      });

      expect(res.status).toBe(200);
    });

    it('should update multiple fields at once', async () => {
      const existingProject = { id: 'project-1', ownerId: 'test-user-id' };
      const updatedProject = {
        id: 'project-1',
        name: 'Updated',
        status: 'completed',
        description: 'Done',
        ownerId: 'test-user-id',
      };

      mockDb.query.projects.findFirst
        .mockResolvedValueOnce(existingProject)
        .mockResolvedValueOnce(updatedProject);

      const res = await app.request('/api/projects/project-1', {
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

  describe('DELETE /api/projects/:id', () => {
    it('should return 404 for non-existent project', async () => {
      mockDb.query.projects.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/projects/non-existent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });

    it('should delete project', async () => {
      mockDb.query.projects.findFirst.mockResolvedValue({
        id: 'project-1',
        ownerId: 'test-user-id',
      });

      const res = await app.request('/api/projects/project-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);
    });
  });

  describe('GET /api/projects/:id/dependencies', () => {
    it('should return 404 for non-existent project', async () => {
      mockDb.query.projects.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/projects/non-existent/dependencies');
      expect(res.status).toBe(404);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Project not found');
    });

    it('should return empty dependencies list', async () => {
      mockDb.query.projects.findFirst.mockResolvedValue({
        id: 'project-1',
        ownerId: 'test-user-id',
      });
      mockDb.query.projectDependencies.findMany.mockResolvedValue([]);

      const res = await app.request('/api/projects/project-1/dependencies');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toEqual([]);
    });

    it('should return project dependencies', async () => {
      mockDb.query.projects.findFirst.mockResolvedValue({
        id: 'project-1',
        ownerId: 'test-user-id',
      });
      mockDb.query.projectDependencies.findMany.mockResolvedValue([
        {
          id: 'dep-1',
          projectId: 'project-1',
          dependsOnProjectId: 'project-2',
          dependsOnProject: { id: 'project-2', name: 'Dependency Project' },
        },
      ]);

      const res = await app.request('/api/projects/project-1/dependencies');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: { id: string; name: string }[] };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.id).toBe('project-2');
    });
  });

  describe('POST /api/projects/:id/dependencies/:dependsOnId', () => {
    it('should return 400 for self-dependency', async () => {
      const res = await app.request('/api/projects/project-1/dependencies/project-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('A project cannot depend on itself');
    });

    it('should return 404 for non-existent project', async () => {
      mockDb.query.projects.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/projects/non-existent/dependencies/project-2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Project not found');
    });

    it('should return 404 for non-existent dependency project', async () => {
      mockDb.query.projects.findFirst
        .mockResolvedValueOnce({ id: 'project-1', ownerId: 'test-user-id' })
        .mockResolvedValueOnce(null);

      const res = await app.request('/api/projects/project-1/dependencies/non-existent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Dependency project not found');
    });

    it('should return 400 for circular dependency', async () => {
      mockDb.query.projects.findFirst
        .mockResolvedValueOnce({ id: 'project-1', ownerId: 'test-user-id' })
        .mockResolvedValueOnce({ id: 'project-2', ownerId: 'test-user-id' });
      mockDb.query.projectDependencies.findFirst.mockResolvedValue({
        id: 'existing-dep',
        projectId: 'project-2',
        dependsOnProjectId: 'project-1',
      });

      const res = await app.request('/api/projects/project-1/dependencies/project-2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Circular dependency detected');
    });

    it('should add dependency', async () => {
      mockDb.query.projects.findFirst
        .mockResolvedValueOnce({ id: 'project-1', ownerId: 'test-user-id' })
        .mockResolvedValueOnce({ id: 'project-2', ownerId: 'test-user-id' });
      mockDb.query.projectDependencies.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/projects/project-1/dependencies/project-2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(201);
    });
  });

  describe('DELETE /api/projects/:id/dependencies/:dependsOnId', () => {
    it('should return 404 for non-existent project', async () => {
      mockDb.query.projects.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/projects/non-existent/dependencies/project-2', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Project not found');
    });

    it('should remove dependency', async () => {
      mockDb.query.projects.findFirst.mockResolvedValue({
        id: 'project-1',
        ownerId: 'test-user-id',
      });

      const res = await app.request('/api/projects/project-1/dependencies/project-2', {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);
    });
  });
});
