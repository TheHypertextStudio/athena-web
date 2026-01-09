/**
 * Tags API integration tests.
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

describe('Tags API', () => {
  beforeEach(() => {
    resetMockDb(mockDb);
  });

  describe('GET /api/tags', () => {
    it('should return empty list when no tags exist', async () => {
      mockDb.query.tags.findMany.mockResolvedValue([]);

      const res = await app.request('/api/tags');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toEqual([]);
    });

    it('should return tags list', async () => {
      const mockTags = [
        {
          id: 'tag-1',
          name: 'urgent',
          color: '#ff0000',
          ownerId: 'test-user-id',
        },
        {
          id: 'tag-2',
          name: 'work',
          color: '#00ff00',
          ownerId: 'test-user-id',
        },
      ];
      mockDb.query.tags.findMany.mockResolvedValue(mockTags);

      const res = await app.request('/api/tags');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockTags };
      expect(body.data).toHaveLength(2);
      expect(body.data[0]?.name).toBe('urgent');
    });

    it('should return tags with associated tasks', async () => {
      const mockTags = [
        {
          id: 'tag-1',
          name: 'urgent',
          color: '#ff0000',
          ownerId: 'test-user-id',
          tasks: [
            { task: { id: 'task-1', title: 'Urgent Task' } },
            { task: { id: 'task-2', title: 'Another Urgent Task' } },
          ],
        },
      ];
      mockDb.query.tags.findMany.mockResolvedValue(mockTags);

      const res = await app.request('/api/tags');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockTags };
      expect(body.data[0]?.tasks).toHaveLength(2);
    });
  });

  describe('GET /api/tags/:id', () => {
    it('should return 404 for non-existent tag', async () => {
      mockDb.query.tags.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/tags/non-existent');
      expect(res.status).toBe(404);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Tag not found');
    });

    it('should return tag by id', async () => {
      const mockTag = {
        id: 'tag-1',
        name: 'urgent',
        color: '#ff0000',
        ownerId: 'test-user-id',
      };
      mockDb.query.tags.findFirst.mockResolvedValue(mockTag);

      const res = await app.request('/api/tags/tag-1');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockTag };
      expect(body.data.id).toBe('tag-1');
      expect(body.data.name).toBe('urgent');
    });

    it('should return tag with associated tasks', async () => {
      const mockTag = {
        id: 'tag-1',
        name: 'urgent',
        color: '#ff0000',
        ownerId: 'test-user-id',
        tasks: [{ task: { id: 'task-1', title: 'Task 1' } }],
      };
      mockDb.query.tags.findFirst.mockResolvedValue(mockTag);

      const res = await app.request('/api/tags/tag-1');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockTag };
      expect(body.data.tasks).toHaveLength(1);
    });
  });

  describe('POST /api/tags', () => {
    it('should create a new tag with only name', async () => {
      const newTag = {
        id: 'new-tag',
        name: 'new-tag',
        ownerId: 'test-user-id',
      };
      mockDb.query.tags.findFirst.mockResolvedValue(newTag);

      const res = await app.request('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'new-tag' }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: typeof newTag };
      expect(body.data.name).toBe('new-tag');
    });

    it('should create tag with color', async () => {
      const newTag = {
        id: 'new-tag',
        name: 'colorful',
        color: '#ff5500',
        ownerId: 'test-user-id',
      };
      mockDb.query.tags.findFirst.mockResolvedValue(newTag);

      const res = await app.request('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'colorful', color: '#ff5500' }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: typeof newTag };
      expect(body.data.color).toBe('#ff5500');
    });
  });

  describe('PATCH /api/tags/:id', () => {
    it('should return 404 for non-existent tag', async () => {
      mockDb.query.tags.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/tags/non-existent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'updated' }),
      });

      expect(res.status).toBe(404);
    });

    it('should update tag name', async () => {
      const existingTag = { id: 'tag-1', name: 'original', ownerId: 'test-user-id' };
      const updatedTag = { id: 'tag-1', name: 'updated', ownerId: 'test-user-id' };

      mockDb.query.tags.findFirst
        .mockResolvedValueOnce(existingTag)
        .mockResolvedValueOnce(updatedTag);

      const res = await app.request('/api/tags/tag-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'updated' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { name: string } };
      expect(body.data.name).toBe('updated');
    });

    it('should update tag color', async () => {
      const existingTag = { id: 'tag-1', color: '#ff0000', ownerId: 'test-user-id' };
      const updatedTag = { id: 'tag-1', color: '#00ff00', ownerId: 'test-user-id' };

      mockDb.query.tags.findFirst
        .mockResolvedValueOnce(existingTag)
        .mockResolvedValueOnce(updatedTag);

      const res = await app.request('/api/tags/tag-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color: '#00ff00' }),
      });

      expect(res.status).toBe(200);
    });

    it('should update both name and color', async () => {
      const existingTag = { id: 'tag-1', name: 'old', color: '#ff0000', ownerId: 'test-user-id' };
      const updatedTag = { id: 'tag-1', name: 'new', color: '#00ff00', ownerId: 'test-user-id' };

      mockDb.query.tags.findFirst
        .mockResolvedValueOnce(existingTag)
        .mockResolvedValueOnce(updatedTag);

      const res = await app.request('/api/tags/tag-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'new', color: '#00ff00' }),
      });

      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/tags/:id', () => {
    it('should return 404 for non-existent tag', async () => {
      mockDb.query.tags.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/tags/non-existent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });

    it('should delete tag', async () => {
      mockDb.query.tags.findFirst.mockResolvedValue({
        id: 'tag-1',
        ownerId: 'test-user-id',
      });

      const res = await app.request('/api/tags/tag-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);
    });
  });
});
