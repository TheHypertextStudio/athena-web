/**
 * Agenda API integration tests.
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

describe('Agenda API', () => {
  beforeEach(() => {
    resetMockDb(mockDb);
  });

  describe('GET /api/agenda', () => {
    it('should return empty agenda when no tasks or events', async () => {
      mockDb.query.tasks.findMany.mockResolvedValue([]);
      mockDb.query.events.findMany.mockResolvedValue([]);

      const res = await app.request('/api/agenda');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data: {
          date: string;
          items: unknown[];
          summary: {
            totalTasks: number;
            completedTasks: number;
            totalEvents: number;
            estimatedMinutes: number;
          };
        };
      };
      expect(body.data.items).toEqual([]);
      expect(body.data.summary.totalTasks).toBe(0);
      expect(body.data.summary.totalEvents).toBe(0);
    });

    it('should return agenda for specific date', async () => {
      mockDb.query.tasks.findMany.mockResolvedValue([]);
      mockDb.query.events.findMany.mockResolvedValue([]);

      const res = await app.request('/api/agenda?date=2026-06-15');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: { date: string } };
      expect(body.data.date).toBe('2026-06-15');
    });

    it('should return tasks and events combined', async () => {
      const mockTasks = [
        {
          id: 'task-1',
          title: 'Complete report',
          status: 'in_progress',
          deadline: new Date('2026-01-05T14:00:00Z'),
          estimatedMinutes: 60,
          project: null,
          tags: [],
        },
      ];
      const mockEvents = [
        {
          id: 'event-1',
          title: 'Team meeting',
          startTime: new Date('2026-01-05T10:00:00Z'),
          endTime: new Date('2026-01-05T11:00:00Z'),
          participants: [],
        },
      ];
      mockDb.query.tasks.findMany.mockResolvedValue(mockTasks);
      mockDb.query.events.findMany.mockResolvedValue(mockEvents);

      const res = await app.request('/api/agenda?date=2026-01-05');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data: {
          items: { type: string }[];
          summary: {
            totalTasks: number;
            totalEvents: number;
            estimatedMinutes: number;
          };
        };
      };
      expect(body.data.items).toHaveLength(2);
      expect(body.data.summary.totalTasks).toBe(1);
      expect(body.data.summary.totalEvents).toBe(1);
      expect(body.data.summary.estimatedMinutes).toBe(60);
    });

    it('should sort items by time', async () => {
      const mockTasks = [
        {
          id: 'task-1',
          title: 'Late task',
          status: 'in_progress',
          deadline: new Date('2026-01-05T15:00:00Z'),
          estimatedMinutes: null,
          project: null,
          tags: [],
        },
      ];
      const mockEvents = [
        {
          id: 'event-1',
          title: 'Early meeting',
          startTime: new Date('2026-01-05T09:00:00Z'),
          endTime: new Date('2026-01-05T10:00:00Z'),
          participants: [],
        },
      ];
      mockDb.query.tasks.findMany.mockResolvedValue(mockTasks);
      mockDb.query.events.findMany.mockResolvedValue(mockEvents);

      const res = await app.request('/api/agenda?date=2026-01-05');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data: {
          items: { type: string }[];
        };
      };
      // Event should come first (9 AM) before task (3 PM)
      expect(body.data.items[0]?.type).toBe('event');
      expect(body.data.items[1]?.type).toBe('task');
    });

    it('should handle tasks without deadline', async () => {
      const mockTasks = [
        {
          id: 'task-1',
          title: 'No deadline task',
          status: 'in_progress',
          deadline: null,
          estimatedMinutes: 30,
          project: null,
          tags: [],
        },
      ];
      mockDb.query.tasks.findMany.mockResolvedValue(mockTasks);
      mockDb.query.events.findMany.mockResolvedValue([]);

      const res = await app.request('/api/agenda?date=2026-01-05');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data: {
          items: { type: string }[];
        };
      };
      expect(body.data.items).toHaveLength(1);
    });

    it('should calculate estimated hours correctly', async () => {
      const mockTasks = [
        {
          id: 'task-1',
          status: 'in_progress',
          deadline: null,
          estimatedMinutes: 90,
          project: null,
          tags: [],
        },
        {
          id: 'task-2',
          status: 'pending',
          deadline: null,
          estimatedMinutes: 30,
          project: null,
          tags: [],
        },
      ];
      mockDb.query.tasks.findMany.mockResolvedValue(mockTasks);
      mockDb.query.events.findMany.mockResolvedValue([]);

      const res = await app.request('/api/agenda?date=2026-01-05');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data: {
          summary: {
            estimatedMinutes: number;
            estimatedHours: number;
          };
        };
      };
      expect(body.data.summary.estimatedMinutes).toBe(120);
      expect(body.data.summary.estimatedHours).toBe(2);
    });
  });

  describe('GET /api/agenda/range', () => {
    it('should return 400 when dates are missing', async () => {
      const res = await app.request('/api/agenda/range');
      expect(res.status).toBe(400);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('startDate and endDate are required');
    });

    it('should return 400 when only startDate provided', async () => {
      const res = await app.request('/api/agenda/range?startDate=2026-01-01');
      expect(res.status).toBe(400);
    });

    it('should return 400 when only endDate provided', async () => {
      const res = await app.request('/api/agenda/range?endDate=2026-01-31');
      expect(res.status).toBe(400);
    });

    it('should return agenda for date range', async () => {
      mockDb.query.tasks.findMany.mockResolvedValue([]);
      mockDb.query.events.findMany.mockResolvedValue([]);

      const res = await app.request('/api/agenda/range?startDate=2026-01-01&endDate=2026-01-31');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data: {
          startDate: string;
          endDate: string;
          tasks: unknown[];
          events: unknown[];
          summary: {
            totalTasks: number;
            totalEvents: number;
          };
        };
      };
      expect(body.data.startDate).toBe('2026-01-01');
      expect(body.data.endDate).toBe('2026-01-31');
    });

    it('should return tasks and events in range', async () => {
      const mockTasks = [
        {
          id: 'task-1',
          title: 'Task in range',
          status: 'pending',
          deadline: new Date('2026-01-15'),
          project: { id: 'proj-1', name: 'Project 1' },
          tags: [],
        },
      ];
      const mockEvents = [
        {
          id: 'event-1',
          title: 'Event in range',
          startTime: new Date('2026-01-10T10:00:00Z'),
          endTime: new Date('2026-01-10T11:00:00Z'),
          participants: [],
        },
        {
          id: 'event-2',
          title: 'Another event',
          startTime: new Date('2026-01-20T14:00:00Z'),
          endTime: new Date('2026-01-20T15:00:00Z'),
          participants: [],
        },
      ];
      mockDb.query.tasks.findMany.mockResolvedValue(mockTasks);
      mockDb.query.events.findMany.mockResolvedValue(mockEvents);

      const res = await app.request('/api/agenda/range?startDate=2026-01-01&endDate=2026-01-31');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data: {
          tasks: unknown[];
          events: unknown[];
          summary: {
            totalTasks: number;
            totalEvents: number;
          };
        };
      };
      expect(body.data.tasks).toHaveLength(1);
      expect(body.data.events).toHaveLength(2);
      expect(body.data.summary.totalTasks).toBe(1);
      expect(body.data.summary.totalEvents).toBe(2);
    });
  });
});
