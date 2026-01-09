/**
 * Moments API integration tests.
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

describe('Moments API', () => {
  beforeEach(() => {
    resetMockDb(mockDb);
  });

  describe('GET /api/moments', () => {
    it('should return empty list when no moments exist', async () => {
      mockDb.query.moments.findMany.mockResolvedValue([]);

      const res = await app.request('/api/moments');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toEqual([]);
    });

    it('should return moments list', async () => {
      const mockMoments = [
        {
          id: 'moment-1',
          label: 'Deep Work',
          startTime: new Date('2026-01-05T09:00:00Z'),
          endTime: new Date('2026-01-05T12:00:00Z'),
          ownerId: 'test-user-id',
        },
      ];
      mockDb.query.moments.findMany.mockResolvedValue(mockMoments);

      const res = await app.request('/api/moments');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockMoments };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.label).toBe('Deep Work');
    });

    it('should filter moments by startDate', async () => {
      mockDb.query.moments.findMany.mockResolvedValue([]);

      const res = await app.request('/api/moments?startDate=2026-01-01');
      expect(res.status).toBe(200);
    });

    it('should filter moments by endDate', async () => {
      mockDb.query.moments.findMany.mockResolvedValue([]);

      const res = await app.request('/api/moments?endDate=2026-12-31');
      expect(res.status).toBe(200);
    });

    it('should combine date filters', async () => {
      mockDb.query.moments.findMany.mockResolvedValue([]);

      const res = await app.request('/api/moments?startDate=2026-01-01&endDate=2026-12-31');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/moments/:id', () => {
    it('should return 404 for non-existent moment', async () => {
      mockDb.query.moments.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/moments/non-existent');
      expect(res.status).toBe(404);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Moment not found');
    });

    it('should return moment by id', async () => {
      const mockMoment = {
        id: 'moment-1',
        label: 'Focus Time',
        startTime: new Date('2026-01-05T09:00:00Z'),
        endTime: new Date('2026-01-05T12:00:00Z'),
        ownerId: 'test-user-id',
      };
      mockDb.query.moments.findFirst.mockResolvedValue(mockMoment);

      const res = await app.request('/api/moments/moment-1');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockMoment };
      expect(body.data.id).toBe('moment-1');
      expect(body.data.label).toBe('Focus Time');
    });
  });

  describe('POST /api/moments', () => {
    it('should create a new moment with minimal fields', async () => {
      const newMoment = {
        id: 'new-moment',
        startTime: new Date('2026-01-05T09:00:00Z'),
        endTime: new Date('2026-01-05T12:00:00Z'),
        ownerId: 'test-user-id',
      };
      mockDb.query.moments.findFirst.mockResolvedValue(newMoment);

      const res = await app.request('/api/moments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startTime: '2026-01-05T09:00:00Z',
          endTime: '2026-01-05T12:00:00Z',
        }),
      });

      expect(res.status).toBe(201);
    });

    it('should create moment with all optional fields', async () => {
      const newMoment = {
        id: 'new-moment',
        label: 'Morning Routine',
        description: 'Daily morning activities',
        startTime: new Date('2026-01-05T06:00:00Z'),
        endTime: new Date('2026-01-05T08:00:00Z'),
        ownerId: 'test-user-id',
      };
      mockDb.query.moments.findFirst.mockResolvedValue(newMoment);

      const res = await app.request('/api/moments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: 'Morning Routine',
          description: 'Daily morning activities',
          startTime: '2026-01-05T06:00:00Z',
          endTime: '2026-01-05T08:00:00Z',
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: typeof newMoment };
      expect(body.data.label).toBe('Morning Routine');
    });
  });

  describe('PATCH /api/moments/:id', () => {
    it('should return 404 for non-existent moment', async () => {
      mockDb.query.moments.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/moments/non-existent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Updated' }),
      });

      expect(res.status).toBe(404);
    });

    it('should update moment label', async () => {
      const existingMoment = { id: 'moment-1', label: 'Original', ownerId: 'test-user-id' };
      const updatedMoment = { id: 'moment-1', label: 'Updated', ownerId: 'test-user-id' };

      mockDb.query.moments.findFirst
        .mockResolvedValueOnce(existingMoment)
        .mockResolvedValueOnce(updatedMoment);

      const res = await app.request('/api/moments/moment-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Updated' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { label: string } };
      expect(body.data.label).toBe('Updated');
    });

    it('should update moment description', async () => {
      const existingMoment = { id: 'moment-1', description: null, ownerId: 'test-user-id' };
      const updatedMoment = {
        id: 'moment-1',
        description: 'New description',
        ownerId: 'test-user-id',
      };

      mockDb.query.moments.findFirst
        .mockResolvedValueOnce(existingMoment)
        .mockResolvedValueOnce(updatedMoment);

      const res = await app.request('/api/moments/moment-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'New description' }),
      });

      expect(res.status).toBe(200);
    });

    it('should update moment times', async () => {
      const existingMoment = {
        id: 'moment-1',
        startTime: new Date('2026-01-05T09:00:00Z'),
        endTime: new Date('2026-01-05T12:00:00Z'),
        ownerId: 'test-user-id',
      };
      const updatedMoment = {
        id: 'moment-1',
        startTime: new Date('2026-01-05T10:00:00Z'),
        endTime: new Date('2026-01-05T13:00:00Z'),
        ownerId: 'test-user-id',
      };

      mockDb.query.moments.findFirst
        .mockResolvedValueOnce(existingMoment)
        .mockResolvedValueOnce(updatedMoment);

      const res = await app.request('/api/moments/moment-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startTime: '2026-01-05T10:00:00Z',
          endTime: '2026-01-05T13:00:00Z',
        }),
      });

      expect(res.status).toBe(200);
    });

    it('should update multiple fields at once', async () => {
      const existingMoment = { id: 'moment-1', ownerId: 'test-user-id' };
      const updatedMoment = {
        id: 'moment-1',
        label: 'Updated Label',
        description: 'Updated description',
        ownerId: 'test-user-id',
      };

      mockDb.query.moments.findFirst
        .mockResolvedValueOnce(existingMoment)
        .mockResolvedValueOnce(updatedMoment);

      const res = await app.request('/api/moments/moment-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: 'Updated Label',
          description: 'Updated description',
        }),
      });

      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/moments/:id', () => {
    it('should return 404 for non-existent moment', async () => {
      mockDb.query.moments.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/moments/non-existent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });

    it('should delete moment', async () => {
      mockDb.query.moments.findFirst.mockResolvedValue({
        id: 'moment-1',
        ownerId: 'test-user-id',
      });

      const res = await app.request('/api/moments/moment-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);
    });
  });
});
