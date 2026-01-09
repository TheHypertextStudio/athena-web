/**
 * Activities API integration tests.
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

describe('Activities API', () => {
  beforeEach(() => {
    resetMockDb(mockDb);
  });

  // Activity Streams
  describe('GET /api/activities/streams', () => {
    it('should return empty list when no streams exist', async () => {
      mockDb.query.activityStreams.findMany.mockResolvedValue([]);

      const res = await app.request('/api/activities/streams');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toEqual([]);
    });

    it('should return activity streams list', async () => {
      const mockStreams = [
        {
          id: 'stream-1',
          name: 'Development Activity',
          source: 'github',
          ownerId: 'test-user-id',
          activities: [],
        },
      ];
      mockDb.query.activityStreams.findMany.mockResolvedValue(mockStreams);

      const res = await app.request('/api/activities/streams');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockStreams };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.name).toBe('Development Activity');
    });

    it('should return streams with recent activities', async () => {
      const mockStreams = [
        {
          id: 'stream-1',
          name: 'Development Activity',
          source: 'github',
          ownerId: 'test-user-id',
          activities: [
            { id: 'activity-1', type: 'commit' },
            { id: 'activity-2', type: 'pr' },
          ],
        },
      ];
      mockDb.query.activityStreams.findMany.mockResolvedValue(mockStreams);

      const res = await app.request('/api/activities/streams');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockStreams };
      expect(body.data[0]?.activities).toHaveLength(2);
    });
  });

  describe('GET /api/activities/streams/:id', () => {
    it('should return 404 for non-existent stream', async () => {
      mockDb.query.activityStreams.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/activities/streams/non-existent');
      expect(res.status).toBe(404);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Activity stream not found');
    });

    it('should return stream by id', async () => {
      const mockStream = {
        id: 'stream-1',
        name: 'Development Activity',
        source: 'github',
        ownerId: 'test-user-id',
        activities: [],
      };
      mockDb.query.activityStreams.findFirst.mockResolvedValue(mockStream);

      const res = await app.request('/api/activities/streams/stream-1');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockStream };
      expect(body.data.id).toBe('stream-1');
      expect(body.data.name).toBe('Development Activity');
    });
  });

  describe('POST /api/activities/streams', () => {
    it('should create a new activity stream', async () => {
      const newStream = {
        id: 'new-stream',
        name: 'New Stream',
        source: 'manual',
        ownerId: 'test-user-id',
      };
      mockDb.query.activityStreams.findFirst.mockResolvedValue(newStream);

      const res = await app.request('/api/activities/streams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Stream', source: 'manual' }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: typeof newStream };
      expect(body.data.name).toBe('New Stream');
      expect(body.data.source).toBe('manual');
    });
  });

  describe('PATCH /api/activities/streams/:id', () => {
    it('should return 404 for non-existent stream', async () => {
      mockDb.query.activityStreams.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/activities/streams/non-existent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(404);
    });

    it('should update stream name', async () => {
      const existingStream = { id: 'stream-1', name: 'Original', ownerId: 'test-user-id' };
      const updatedStream = { id: 'stream-1', name: 'Updated', ownerId: 'test-user-id' };

      mockDb.query.activityStreams.findFirst
        .mockResolvedValueOnce(existingStream)
        .mockResolvedValueOnce(updatedStream);

      const res = await app.request('/api/activities/streams/stream-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { name: string } };
      expect(body.data.name).toBe('Updated');
    });

    it('should update stream source', async () => {
      const existingStream = { id: 'stream-1', source: 'manual', ownerId: 'test-user-id' };
      const updatedStream = { id: 'stream-1', source: 'github', ownerId: 'test-user-id' };

      mockDb.query.activityStreams.findFirst
        .mockResolvedValueOnce(existingStream)
        .mockResolvedValueOnce(updatedStream);

      const res = await app.request('/api/activities/streams/stream-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'github' }),
      });

      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/activities/streams/:id', () => {
    it('should return 404 for non-existent stream', async () => {
      mockDb.query.activityStreams.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/activities/streams/non-existent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });

    it('should delete stream', async () => {
      mockDb.query.activityStreams.findFirst.mockResolvedValue({
        id: 'stream-1',
        ownerId: 'test-user-id',
      });

      const res = await app.request('/api/activities/streams/stream-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);
    });
  });

  // Activities within Streams
  describe('GET /api/activities/streams/:streamId/activities', () => {
    it('should return 404 for non-existent stream', async () => {
      mockDb.query.activityStreams.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/activities/streams/non-existent/activities');
      expect(res.status).toBe(404);
    });

    it('should return activities for stream', async () => {
      mockDb.query.activityStreams.findFirst.mockResolvedValue({
        id: 'stream-1',
        ownerId: 'test-user-id',
      });
      const mockActivities = [
        {
          id: 'activity-1',
          type: 'commit',
          streamId: 'stream-1',
          startTime: new Date(),
          endTime: new Date(),
        },
      ];
      mockDb.query.activities.findMany.mockResolvedValue(mockActivities);

      const res = await app.request('/api/activities/streams/stream-1/activities');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockActivities };
      expect(body.data).toHaveLength(1);
    });

    it('should filter activities by date range', async () => {
      mockDb.query.activityStreams.findFirst.mockResolvedValue({
        id: 'stream-1',
        ownerId: 'test-user-id',
      });
      mockDb.query.activities.findMany.mockResolvedValue([]);

      const res = await app.request(
        '/api/activities/streams/stream-1/activities?startDate=2026-01-01&endDate=2026-01-31',
      );
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/activities/streams/:streamId/activities', () => {
    it('should return 404 for non-existent stream', async () => {
      mockDb.query.activityStreams.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/activities/streams/non-existent/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'commit',
          startTime: '2026-01-05T09:00:00Z',
          endTime: '2026-01-05T10:00:00Z',
        }),
      });

      expect(res.status).toBe(404);
    });

    it('should create activity in stream', async () => {
      mockDb.query.activityStreams.findFirst.mockResolvedValue({
        id: 'stream-1',
        ownerId: 'test-user-id',
      });
      const newActivity = {
        id: 'new-activity',
        type: 'commit',
        streamId: 'stream-1',
        startTime: new Date('2026-01-05T09:00:00Z'),
        endTime: new Date('2026-01-05T10:00:00Z'),
      };
      mockDb.query.activities.findFirst.mockResolvedValue(newActivity);

      const res = await app.request('/api/activities/streams/stream-1/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'commit',
          startTime: '2026-01-05T09:00:00Z',
          endTime: '2026-01-05T10:00:00Z',
        }),
      });

      expect(res.status).toBe(201);
    });

    it('should create activity with metadata', async () => {
      mockDb.query.activityStreams.findFirst.mockResolvedValue({
        id: 'stream-1',
        ownerId: 'test-user-id',
      });
      const newActivity = {
        id: 'new-activity',
        type: 'commit',
        streamId: 'stream-1',
        metadata: { repo: 'my-repo', sha: 'abc123' },
      };
      mockDb.query.activities.findFirst.mockResolvedValue(newActivity);

      const res = await app.request('/api/activities/streams/stream-1/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'commit',
          startTime: '2026-01-05T09:00:00Z',
          endTime: '2026-01-05T10:00:00Z',
          metadata: { repo: 'my-repo', sha: 'abc123' },
        }),
      });

      expect(res.status).toBe(201);
    });
  });

  // Individual Activities
  describe('GET /api/activities/:id', () => {
    it('should return 404 for non-existent activity', async () => {
      mockDb.query.activities.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/activities/non-existent');
      expect(res.status).toBe(404);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Activity not found');
    });

    it('should return 404 if stream not owned by user', async () => {
      mockDb.query.activities.findFirst.mockResolvedValue({
        id: 'activity-1',
        streamId: 'stream-1',
        stream: { id: 'stream-1', ownerId: 'other-user' },
      });
      mockDb.query.activityStreams.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/activities/activity-1');
      expect(res.status).toBe(404);
    });

    it('should return activity by id', async () => {
      mockDb.query.activities.findFirst.mockResolvedValue({
        id: 'activity-1',
        type: 'commit',
        streamId: 'stream-1',
        stream: { id: 'stream-1', ownerId: 'test-user-id' },
      });
      mockDb.query.activityStreams.findFirst.mockResolvedValue({
        id: 'stream-1',
        ownerId: 'test-user-id',
      });

      const res = await app.request('/api/activities/activity-1');
      expect(res.status).toBe(200);
    });
  });

  describe('PATCH /api/activities/:id', () => {
    it('should return 404 for non-existent activity', async () => {
      mockDb.query.activities.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/activities/non-existent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'updated' }),
      });

      expect(res.status).toBe(404);
    });

    it('should return 404 if stream not owned by user', async () => {
      mockDb.query.activities.findFirst.mockResolvedValue({
        id: 'activity-1',
        streamId: 'stream-1',
        stream: { id: 'stream-1', ownerId: 'other-user' },
      });
      mockDb.query.activityStreams.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/activities/activity-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'updated' }),
      });

      expect(res.status).toBe(404);
    });

    it('should update activity type', async () => {
      mockDb.query.activities.findFirst
        .mockResolvedValueOnce({
          id: 'activity-1',
          type: 'commit',
          streamId: 'stream-1',
          stream: { id: 'stream-1', ownerId: 'test-user-id' },
        })
        .mockResolvedValueOnce({
          id: 'activity-1',
          type: 'pr',
          streamId: 'stream-1',
        });
      mockDb.query.activityStreams.findFirst.mockResolvedValue({
        id: 'stream-1',
        ownerId: 'test-user-id',
      });

      const res = await app.request('/api/activities/activity-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'pr' }),
      });

      expect(res.status).toBe(200);
    });

    it('should update activity times', async () => {
      mockDb.query.activities.findFirst
        .mockResolvedValueOnce({
          id: 'activity-1',
          streamId: 'stream-1',
          stream: { id: 'stream-1', ownerId: 'test-user-id' },
        })
        .mockResolvedValueOnce({
          id: 'activity-1',
          startTime: new Date('2026-01-05T10:00:00Z'),
          endTime: new Date('2026-01-05T12:00:00Z'),
        });
      mockDb.query.activityStreams.findFirst.mockResolvedValue({
        id: 'stream-1',
        ownerId: 'test-user-id',
      });

      const res = await app.request('/api/activities/activity-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startTime: '2026-01-05T10:00:00Z',
          endTime: '2026-01-05T12:00:00Z',
        }),
      });

      expect(res.status).toBe(200);
    });

    it('should update activity metadata', async () => {
      mockDb.query.activities.findFirst
        .mockResolvedValueOnce({
          id: 'activity-1',
          streamId: 'stream-1',
          stream: { id: 'stream-1', ownerId: 'test-user-id' },
        })
        .mockResolvedValueOnce({
          id: 'activity-1',
          metadata: { updated: true },
        });
      mockDb.query.activityStreams.findFirst.mockResolvedValue({
        id: 'stream-1',
        ownerId: 'test-user-id',
      });

      const res = await app.request('/api/activities/activity-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata: { updated: true } }),
      });

      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/activities/:id', () => {
    it('should return 404 for non-existent activity', async () => {
      mockDb.query.activities.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/activities/non-existent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });

    it('should return 404 if stream not owned by user', async () => {
      mockDb.query.activities.findFirst.mockResolvedValue({
        id: 'activity-1',
        streamId: 'stream-1',
      });
      mockDb.query.activityStreams.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/activities/activity-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });

    it('should delete activity', async () => {
      mockDb.query.activities.findFirst.mockResolvedValue({
        id: 'activity-1',
        streamId: 'stream-1',
      });
      mockDb.query.activityStreams.findFirst.mockResolvedValue({
        id: 'stream-1',
        ownerId: 'test-user-id',
      });

      const res = await app.request('/api/activities/activity-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);
    });
  });
});
