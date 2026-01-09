/**
 * Settings API integration tests.
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

describe('Settings API', () => {
  beforeEach(() => {
    resetMockDb(mockDb);
  });

  describe('GET /api/settings', () => {
    it('should return default settings when none exist', async () => {
      mockDb.query.userSettings.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/settings');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data: {
          preferredName: string | null;
          timezone: string;
          dailyPlanningTime: string | null;
          dailyReviewTime: string | null;
          encryptionEnabled: boolean;
        };
      };
      expect(body.data.timezone).toBe('UTC');
      expect(body.data.encryptionEnabled).toBe(false);
      expect(body.data.preferredName).toBeNull();
    });

    it('should return existing settings', async () => {
      const mockSettings = {
        id: 'settings-1',
        userId: 'test-user-id',
        preferredName: 'John',
        timezone: 'America/New_York',
        dailyPlanningTime: '09:00',
        dailyReviewTime: '18:00',
        encryptionEnabled: true,
      };
      mockDb.query.userSettings.findFirst.mockResolvedValue(mockSettings);

      const res = await app.request('/api/settings');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockSettings };
      expect(body.data.preferredName).toBe('John');
      expect(body.data.timezone).toBe('America/New_York');
      expect(body.data.encryptionEnabled).toBe(true);
    });
  });

  describe('PATCH /api/settings', () => {
    it('should create settings if they do not exist', async () => {
      const newSettings = {
        id: 'settings-1',
        userId: 'test-user-id',
        preferredName: 'Jane',
        timezone: 'UTC',
        encryptionEnabled: false,
      };
      mockDb.query.userSettings.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(newSettings);

      const res = await app.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredName: 'Jane' }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: typeof newSettings };
      expect(body.data.preferredName).toBe('Jane');
    });

    it('should update preferredName', async () => {
      const existingSettings = {
        id: 'settings-1',
        userId: 'test-user-id',
        preferredName: 'Old Name',
      };
      const updatedSettings = {
        id: 'settings-1',
        userId: 'test-user-id',
        preferredName: 'New Name',
      };

      mockDb.query.userSettings.findFirst
        .mockResolvedValueOnce(existingSettings)
        .mockResolvedValueOnce(updatedSettings);

      const res = await app.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredName: 'New Name' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { preferredName: string } };
      expect(body.data.preferredName).toBe('New Name');
    });

    it('should clear preferredName with null', async () => {
      const existingSettings = {
        id: 'settings-1',
        userId: 'test-user-id',
        preferredName: 'Old Name',
      };
      const updatedSettings = {
        id: 'settings-1',
        userId: 'test-user-id',
        preferredName: null,
      };

      mockDb.query.userSettings.findFirst
        .mockResolvedValueOnce(existingSettings)
        .mockResolvedValueOnce(updatedSettings);

      const res = await app.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredName: null }),
      });

      expect(res.status).toBe(200);
    });

    it('should update timezone', async () => {
      const existingSettings = {
        id: 'settings-1',
        userId: 'test-user-id',
        timezone: 'UTC',
      };
      const updatedSettings = {
        id: 'settings-1',
        userId: 'test-user-id',
        timezone: 'America/Los_Angeles',
      };

      mockDb.query.userSettings.findFirst
        .mockResolvedValueOnce(existingSettings)
        .mockResolvedValueOnce(updatedSettings);

      const res = await app.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: 'America/Los_Angeles' }),
      });

      expect(res.status).toBe(200);
    });

    it('should update dailyPlanningTime', async () => {
      const existingSettings = {
        id: 'settings-1',
        userId: 'test-user-id',
        dailyPlanningTime: null,
      };
      const updatedSettings = {
        id: 'settings-1',
        userId: 'test-user-id',
        dailyPlanningTime: '08:00',
      };

      mockDb.query.userSettings.findFirst
        .mockResolvedValueOnce(existingSettings)
        .mockResolvedValueOnce(updatedSettings);

      const res = await app.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dailyPlanningTime: '08:00' }),
      });

      expect(res.status).toBe(200);
    });

    it('should clear dailyPlanningTime with null', async () => {
      const existingSettings = {
        id: 'settings-1',
        userId: 'test-user-id',
        dailyPlanningTime: '08:00',
      };
      const updatedSettings = {
        id: 'settings-1',
        userId: 'test-user-id',
        dailyPlanningTime: null,
      };

      mockDb.query.userSettings.findFirst
        .mockResolvedValueOnce(existingSettings)
        .mockResolvedValueOnce(updatedSettings);

      const res = await app.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dailyPlanningTime: null }),
      });

      expect(res.status).toBe(200);
    });

    it('should update dailyReviewTime', async () => {
      const existingSettings = {
        id: 'settings-1',
        userId: 'test-user-id',
        dailyReviewTime: null,
      };
      const updatedSettings = {
        id: 'settings-1',
        userId: 'test-user-id',
        dailyReviewTime: '17:00',
      };

      mockDb.query.userSettings.findFirst
        .mockResolvedValueOnce(existingSettings)
        .mockResolvedValueOnce(updatedSettings);

      const res = await app.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dailyReviewTime: '17:00' }),
      });

      expect(res.status).toBe(200);
    });

    it('should update encryptionEnabled', async () => {
      const existingSettings = {
        id: 'settings-1',
        userId: 'test-user-id',
        encryptionEnabled: false,
      };
      const updatedSettings = {
        id: 'settings-1',
        userId: 'test-user-id',
        encryptionEnabled: true,
      };

      mockDb.query.userSettings.findFirst
        .mockResolvedValueOnce(existingSettings)
        .mockResolvedValueOnce(updatedSettings);

      const res = await app.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encryptionEnabled: true }),
      });

      expect(res.status).toBe(200);
    });

    it('should update multiple settings at once', async () => {
      const existingSettings = {
        id: 'settings-1',
        userId: 'test-user-id',
      };
      const updatedSettings = {
        id: 'settings-1',
        userId: 'test-user-id',
        preferredName: 'John',
        timezone: 'Europe/London',
        dailyPlanningTime: '09:00',
        dailyReviewTime: '18:00',
        encryptionEnabled: true,
      };

      mockDb.query.userSettings.findFirst
        .mockResolvedValueOnce(existingSettings)
        .mockResolvedValueOnce(updatedSettings);

      const res = await app.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferredName: 'John',
          timezone: 'Europe/London',
          dailyPlanningTime: '09:00',
          dailyReviewTime: '18:00',
          encryptionEnabled: true,
        }),
      });

      expect(res.status).toBe(200);
    });
  });
});
