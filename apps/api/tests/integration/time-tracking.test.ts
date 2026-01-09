/**
 * Time Tracking API integration tests.
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

describe('Time Tracking API', () => {
  beforeEach(() => {
    resetMockDb(mockDb);
  });

  describe('GET /api/time-tracking', () => {
    it('should return empty list when no time entries exist', async () => {
      mockDb.query.timeEntries.findMany.mockResolvedValue([]);

      const res = await app.request('/api/time-tracking');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toEqual([]);
    });

    it('should return time entries list', async () => {
      const mockEntries = [
        {
          id: 'entry-1',
          userId: 'test-user-id',
          startTime: new Date('2026-01-05T09:00:00Z'),
          endTime: new Date('2026-01-05T12:00:00Z'),
          description: 'Working on task',
          task: { id: 'task-1', title: 'Task 1' },
        },
      ];
      mockDb.query.timeEntries.findMany.mockResolvedValue(mockEntries);

      const res = await app.request('/api/time-tracking');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockEntries };
      expect(body.data).toHaveLength(1);
    });

    it('should filter entries by taskId', async () => {
      mockDb.query.timeEntries.findMany.mockResolvedValue([]);

      const res = await app.request('/api/time-tracking?taskId=task-1');
      expect(res.status).toBe(200);
    });

    it('should filter entries by startDate', async () => {
      mockDb.query.timeEntries.findMany.mockResolvedValue([]);

      const res = await app.request('/api/time-tracking?startDate=2026-01-01');
      expect(res.status).toBe(200);
    });

    it('should filter entries by endDate', async () => {
      mockDb.query.timeEntries.findMany.mockResolvedValue([]);

      const res = await app.request('/api/time-tracking?endDate=2026-12-31');
      expect(res.status).toBe(200);
    });

    it('should combine multiple filters', async () => {
      mockDb.query.timeEntries.findMany.mockResolvedValue([]);

      const res = await app.request(
        '/api/time-tracking?taskId=task-1&startDate=2026-01-01&endDate=2026-12-31',
      );
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/time-tracking/summary', () => {
    it('should return 400 when dates are missing', async () => {
      const res = await app.request('/api/time-tracking/summary');
      expect(res.status).toBe(400);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('startDate and endDate are required');
    });

    it('should return summary for date range', async () => {
      const mockEntries = [
        {
          id: 'entry-1',
          userId: 'test-user-id',
          startTime: new Date('2026-01-05T09:00:00Z'),
          endTime: new Date('2026-01-05T12:00:00Z'),
          task: { id: 'task-1', title: 'Task 1', project: { id: 'proj-1', name: 'Project 1' } },
        },
        {
          id: 'entry-2',
          userId: 'test-user-id',
          startTime: new Date('2026-01-05T14:00:00Z'),
          endTime: new Date('2026-01-05T16:00:00Z'),
          task: { id: 'task-1', title: 'Task 1', project: { id: 'proj-1', name: 'Project 1' } },
        },
      ];
      mockDb.query.timeEntries.findMany.mockResolvedValue(mockEntries);

      const res = await app.request(
        '/api/time-tracking/summary?startDate=2026-01-01&endDate=2026-01-31',
      );
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data: {
          totalMinutes: number;
          totalHours: number;
          entryCount: number;
          taskBreakdown: Record<string, number>;
          projectBreakdown: Record<string, number>;
        };
      };
      expect(body.data.entryCount).toBe(2);
      expect(body.data.totalMinutes).toBe(300); // 3 hours + 2 hours = 300 minutes
    });

    it('should handle entries without endTime', async () => {
      const mockEntries = [
        {
          id: 'entry-1',
          userId: 'test-user-id',
          startTime: new Date('2026-01-05T09:00:00Z'),
          endTime: null,
          task: null,
        },
      ];
      mockDb.query.timeEntries.findMany.mockResolvedValue(mockEntries);

      const res = await app.request(
        '/api/time-tracking/summary?startDate=2026-01-01&endDate=2026-01-31',
      );
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data: {
          totalMinutes: number;
        };
      };
      expect(body.data.totalMinutes).toBe(0);
    });
  });

  describe('GET /api/time-tracking/active', () => {
    it('should return null when no active timer', async () => {
      mockDb.query.timeEntries.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/time-tracking/active');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: null };
      expect(body.data).toBeNull();
    });

    it('should return active timer', async () => {
      const activeEntry = {
        id: 'entry-1',
        userId: 'test-user-id',
        startTime: new Date('2026-01-05T09:00:00Z'),
        endTime: null,
        description: 'Working on task',
        task: { id: 'task-1', title: 'Task 1' },
      };
      mockDb.query.timeEntries.findFirst.mockResolvedValue(activeEntry);

      const res = await app.request('/api/time-tracking/active');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof activeEntry };
      expect(body.data.endTime).toBeNull();
    });
  });

  describe('GET /api/time-tracking/:id', () => {
    it('should return 404 for non-existent entry', async () => {
      mockDb.query.timeEntries.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/time-tracking/non-existent');
      expect(res.status).toBe(404);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Time entry not found');
    });

    it('should return time entry by id', async () => {
      const mockEntry = {
        id: 'entry-1',
        userId: 'test-user-id',
        startTime: new Date('2026-01-05T09:00:00Z'),
        endTime: new Date('2026-01-05T12:00:00Z'),
        task: { id: 'task-1', title: 'Task 1' },
      };
      mockDb.query.timeEntries.findFirst.mockResolvedValue(mockEntry);

      const res = await app.request('/api/time-tracking/entry-1');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockEntry };
      expect(body.data.id).toBe('entry-1');
    });
  });

  describe('POST /api/time-tracking/start', () => {
    it('should return 409 if timer already running', async () => {
      mockDb.query.timeEntries.findFirst.mockResolvedValue({
        id: 'active-entry',
        endTime: null,
      });

      const res = await app.request('/api/time-tracking/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('A timer is already running. Stop it first.');
    });

    it('should return 404 if task does not exist', async () => {
      mockDb.query.timeEntries.findFirst.mockResolvedValue(null);
      mockDb.query.tasks.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/time-tracking/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: 'non-existent' }),
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Task not found');
    });

    it('should start timer without task', async () => {
      mockDb.query.timeEntries.findFirst
        .mockResolvedValueOnce(null) // No active timer
        .mockResolvedValueOnce({
          // Return new entry
          id: 'new-entry',
          userId: 'test-user-id',
          startTime: new Date(),
          endTime: null,
        });

      const res = await app.request('/api/time-tracking/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(201);
    });

    it('should start timer with task', async () => {
      mockDb.query.timeEntries.findFirst
        .mockResolvedValueOnce(null) // No active timer
        .mockResolvedValueOnce({
          // Return new entry
          id: 'new-entry',
          userId: 'test-user-id',
          taskId: 'task-1',
          startTime: new Date(),
          endTime: null,
        });
      mockDb.query.tasks.findFirst.mockResolvedValue({ id: 'task-1', title: 'Task 1' });

      const res = await app.request('/api/time-tracking/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: 'task-1' }),
      });

      expect(res.status).toBe(201);
    });

    it('should start timer with description', async () => {
      mockDb.query.timeEntries.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 'new-entry',
        userId: 'test-user-id',
        description: 'Working on feature',
        startTime: new Date(),
        endTime: null,
      });

      const res = await app.request('/api/time-tracking/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Working on feature' }),
      });

      expect(res.status).toBe(201);
    });
  });

  describe('POST /api/time-tracking/stop', () => {
    it('should return 404 if no active timer', async () => {
      mockDb.query.timeEntries.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/time-tracking/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('No active timer to stop');
    });

    it('should stop active timer', async () => {
      const activeEntry = {
        id: 'entry-1',
        userId: 'test-user-id',
        startTime: new Date('2026-01-05T09:00:00Z'),
        endTime: null,
      };
      const stoppedEntry = {
        ...activeEntry,
        endTime: new Date('2026-01-05T12:00:00Z'),
        task: null,
      };

      mockDb.query.timeEntries.findFirst
        .mockResolvedValueOnce(activeEntry)
        .mockResolvedValueOnce(stoppedEntry);

      const res = await app.request('/api/time-tracking/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: typeof stoppedEntry };
      expect(body.data.endTime).not.toBeNull();
    });
  });

  describe('POST /api/time-tracking', () => {
    it('should return 404 if task does not exist', async () => {
      mockDb.query.tasks.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/time-tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: 'non-existent',
          startTime: '2026-01-05T09:00:00Z',
          endTime: '2026-01-05T12:00:00Z',
        }),
      });

      expect(res.status).toBe(404);
    });

    it('should create manual time entry', async () => {
      const newEntry = {
        id: 'new-entry',
        userId: 'test-user-id',
        startTime: new Date('2026-01-05T09:00:00Z'),
        endTime: new Date('2026-01-05T12:00:00Z'),
        task: null,
      };
      mockDb.query.timeEntries.findFirst.mockResolvedValue(newEntry);

      const res = await app.request('/api/time-tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startTime: '2026-01-05T09:00:00Z',
          endTime: '2026-01-05T12:00:00Z',
        }),
      });

      expect(res.status).toBe(201);
    });

    it('should create manual entry with task', async () => {
      const newEntry = {
        id: 'new-entry',
        userId: 'test-user-id',
        taskId: 'task-1',
        startTime: new Date('2026-01-05T09:00:00Z'),
        endTime: new Date('2026-01-05T12:00:00Z'),
        task: { id: 'task-1', title: 'Task 1' },
      };
      mockDb.query.tasks.findFirst.mockResolvedValue({ id: 'task-1' });
      mockDb.query.timeEntries.findFirst.mockResolvedValue(newEntry);

      const res = await app.request('/api/time-tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: 'task-1',
          startTime: '2026-01-05T09:00:00Z',
          endTime: '2026-01-05T12:00:00Z',
        }),
      });

      expect(res.status).toBe(201);
    });

    it('should create entry with description', async () => {
      const newEntry = {
        id: 'new-entry',
        userId: 'test-user-id',
        description: 'Manual entry',
        startTime: new Date('2026-01-05T09:00:00Z'),
        endTime: new Date('2026-01-05T12:00:00Z'),
        task: null,
      };
      mockDb.query.timeEntries.findFirst.mockResolvedValue(newEntry);

      const res = await app.request('/api/time-tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startTime: '2026-01-05T09:00:00Z',
          endTime: '2026-01-05T12:00:00Z',
          description: 'Manual entry',
        }),
      });

      expect(res.status).toBe(201);
    });
  });

  describe('PATCH /api/time-tracking/:id', () => {
    it('should return 404 for non-existent entry', async () => {
      mockDb.query.timeEntries.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/time-tracking/non-existent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Updated' }),
      });

      expect(res.status).toBe(404);
    });

    it('should update time entry description', async () => {
      const existingEntry = { id: 'entry-1', userId: 'test-user-id' };
      const updatedEntry = { ...existingEntry, description: 'Updated', task: null };

      mockDb.query.timeEntries.findFirst
        .mockResolvedValueOnce(existingEntry)
        .mockResolvedValueOnce(updatedEntry);

      const res = await app.request('/api/time-tracking/entry-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Updated' }),
      });

      expect(res.status).toBe(200);
    });

    it('should update time entry taskId', async () => {
      const existingEntry = { id: 'entry-1', userId: 'test-user-id', taskId: null };
      const updatedEntry = { ...existingEntry, taskId: 'task-1', task: null };

      mockDb.query.timeEntries.findFirst
        .mockResolvedValueOnce(existingEntry)
        .mockResolvedValueOnce(updatedEntry);

      const res = await app.request('/api/time-tracking/entry-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: 'task-1' }),
      });

      expect(res.status).toBe(200);
    });

    it('should clear time entry taskId with null', async () => {
      const existingEntry = { id: 'entry-1', userId: 'test-user-id', taskId: 'task-1' };
      const updatedEntry = { ...existingEntry, taskId: null, task: null };

      mockDb.query.timeEntries.findFirst
        .mockResolvedValueOnce(existingEntry)
        .mockResolvedValueOnce(updatedEntry);

      const res = await app.request('/api/time-tracking/entry-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: null }),
      });

      expect(res.status).toBe(200);
    });

    it('should update time entry times', async () => {
      const existingEntry = { id: 'entry-1', userId: 'test-user-id' };
      const updatedEntry = {
        ...existingEntry,
        startTime: new Date('2026-01-05T10:00:00Z'),
        endTime: new Date('2026-01-05T13:00:00Z'),
        task: null,
      };

      mockDb.query.timeEntries.findFirst
        .mockResolvedValueOnce(existingEntry)
        .mockResolvedValueOnce(updatedEntry);

      const res = await app.request('/api/time-tracking/entry-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startTime: '2026-01-05T10:00:00Z',
          endTime: '2026-01-05T13:00:00Z',
        }),
      });

      expect(res.status).toBe(200);
    });

    it('should clear endTime with null', async () => {
      const existingEntry = {
        id: 'entry-1',
        userId: 'test-user-id',
        endTime: new Date(),
      };
      const updatedEntry = { ...existingEntry, endTime: null, task: null };

      mockDb.query.timeEntries.findFirst
        .mockResolvedValueOnce(existingEntry)
        .mockResolvedValueOnce(updatedEntry);

      const res = await app.request('/api/time-tracking/entry-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endTime: null }),
      });

      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/time-tracking/:id', () => {
    it('should return 404 for non-existent entry', async () => {
      mockDb.query.timeEntries.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/time-tracking/non-existent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });

    it('should delete time entry', async () => {
      mockDb.query.timeEntries.findFirst.mockResolvedValue({
        id: 'entry-1',
        userId: 'test-user-id',
      });

      const res = await app.request('/api/time-tracking/entry-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);
    });
  });
});
