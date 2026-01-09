/**
 * Account API integration tests.
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

describe('Account API', () => {
  beforeEach(() => {
    resetMockDb(mockDb);
  });

  describe('GET /api/account', () => {
    it('should return 404 when user not found', async () => {
      mockDb.query.users.findFirst.mockResolvedValue(null);
      mockDb.query.initiatives.findMany.mockResolvedValue([]);
      mockDb.query.projects.findMany.mockResolvedValue([]);
      mockDb.query.tasks.findMany.mockResolvedValue([]);
      mockDb.query.events.findMany.mockResolvedValue([]);

      const res = await app.request('/api/account');
      expect(res.status).toBe(404);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('User not found');
    });

    it('should return account overview', async () => {
      const mockUser = {
        id: 'test-user-id',
        name: 'Test User',
        email: 'test@example.com',
        emailVerified: true,
        image: 'https://example.com/avatar.jpg',
        createdAt: new Date('2025-01-01'),
      };
      mockDb.query.users.findFirst.mockResolvedValue(mockUser);
      mockDb.query.initiatives.findMany.mockResolvedValue([{ id: '1' }, { id: '2' }]);
      mockDb.query.projects.findMany.mockResolvedValue([{ id: '1' }, { id: '2' }, { id: '3' }]);
      mockDb.query.tasks.findMany.mockResolvedValue([{ id: '1' }]);
      mockDb.query.events.findMany.mockResolvedValue([{ id: '1' }, { id: '2' }]);

      const res = await app.request('/api/account');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data: {
          id: string;
          name: string;
          email: string;
          emailVerified: boolean;
          image: string;
          stats: {
            initiatives: number;
            projects: number;
            tasks: number;
            events: number;
          };
        };
      };
      expect(body.data.id).toBe('test-user-id');
      expect(body.data.name).toBe('Test User');
      expect(body.data.email).toBe('test@example.com');
      expect(body.data.stats.initiatives).toBe(2);
      expect(body.data.stats.projects).toBe(3);
      expect(body.data.stats.tasks).toBe(1);
      expect(body.data.stats.events).toBe(2);
    });
  });

  describe('GET /api/account/export', () => {
    it('should export all user data', async () => {
      const mockUser = {
        id: 'test-user-id',
        name: 'Test User',
        email: 'test@example.com',
        createdAt: new Date('2025-01-01'),
      };
      mockDb.query.users.findFirst.mockResolvedValue(mockUser);
      mockDb.query.initiatives.findMany.mockResolvedValue([{ id: 'init-1', name: 'Initiative' }]);
      mockDb.query.projects.findMany.mockResolvedValue([{ id: 'proj-1', name: 'Project' }]);
      mockDb.query.tasks.findMany.mockResolvedValue([{ id: 'task-1', title: 'Task' }]);
      mockDb.query.events.findMany.mockResolvedValue([{ id: 'event-1', title: 'Event' }]);
      mockDb.query.moments.findMany.mockResolvedValue([]);
      mockDb.query.activityStreams.findMany.mockResolvedValue([]);
      mockDb.query.tags.findMany.mockResolvedValue([{ id: 'tag-1', name: 'urgent' }]);
      mockDb.query.timeEntries.findMany.mockResolvedValue([]);
      mockDb.query.workspaces.findMany.mockResolvedValue([]);
      mockDb.query.userSettings.findFirst.mockResolvedValue(null);
      mockDb.query.subscriptions.findFirst.mockResolvedValue(null);
      mockDb.query.linkedIntegrations.findMany.mockResolvedValue([]);

      const res = await app.request('/api/account/export');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        exportVersion: string;
        exportedAt: string;
        user: {
          id: string;
          name: string;
          email: string;
        };
        data: {
          initiatives: unknown[];
          projects: unknown[];
          tasks: unknown[];
          events: unknown[];
          tags: unknown[];
        };
        schema: Record<string, unknown>;
      };

      expect(body.exportVersion).toBe('2.0.0');
      expect(body.user.id).toBe('test-user-id');
      expect(body.data.initiatives).toHaveLength(1);
      expect(body.data.projects).toHaveLength(1);
      expect(body.data.tasks).toHaveLength(1);
      expect(body.data.events).toHaveLength(1);
      expect(body.data.tags).toHaveLength(1);
      expect(body.schema).toBeDefined();
    });

    it('should include subscription info when available', async () => {
      const mockUser = {
        id: 'test-user-id',
        name: 'Test User',
        email: 'test@example.com',
        createdAt: new Date(),
      };
      mockDb.query.users.findFirst.mockResolvedValue(mockUser);
      mockDb.query.initiatives.findMany.mockResolvedValue([]);
      mockDb.query.projects.findMany.mockResolvedValue([]);
      mockDb.query.tasks.findMany.mockResolvedValue([]);
      mockDb.query.events.findMany.mockResolvedValue([]);
      mockDb.query.moments.findMany.mockResolvedValue([]);
      mockDb.query.activityStreams.findMany.mockResolvedValue([]);
      mockDb.query.tags.findMany.mockResolvedValue([]);
      mockDb.query.timeEntries.findMany.mockResolvedValue([]);
      mockDb.query.workspaces.findMany.mockResolvedValue([]);
      mockDb.query.userSettings.findFirst.mockResolvedValue(null);
      mockDb.query.subscriptions.findFirst.mockResolvedValue({
        planTier: 'pro',
        status: 'active',
      });
      mockDb.query.linkedIntegrations.findMany.mockResolvedValue([]);

      const res = await app.request('/api/account/export');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        subscription: {
          planTier: string;
          status: string;
        };
      };
      expect(body.subscription.planTier).toBe('pro');
      expect(body.subscription.status).toBe('active');
    });

    it('should include integrations', async () => {
      const mockUser = {
        id: 'test-user-id',
        name: 'Test User',
        email: 'test@example.com',
        createdAt: new Date(),
      };
      mockDb.query.users.findFirst.mockResolvedValue(mockUser);
      mockDb.query.initiatives.findMany.mockResolvedValue([]);
      mockDb.query.projects.findMany.mockResolvedValue([]);
      mockDb.query.tasks.findMany.mockResolvedValue([]);
      mockDb.query.events.findMany.mockResolvedValue([]);
      mockDb.query.moments.findMany.mockResolvedValue([]);
      mockDb.query.activityStreams.findMany.mockResolvedValue([]);
      mockDb.query.tags.findMany.mockResolvedValue([]);
      mockDb.query.timeEntries.findMany.mockResolvedValue([]);
      mockDb.query.workspaces.findMany.mockResolvedValue([]);
      mockDb.query.userSettings.findFirst.mockResolvedValue(null);
      mockDb.query.subscriptions.findFirst.mockResolvedValue(null);
      mockDb.query.linkedIntegrations.findMany.mockResolvedValue([
        { provider: 'google', createdAt: new Date() },
        { provider: 'github', createdAt: new Date() },
      ]);

      const res = await app.request('/api/account/export');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        integrations: { provider: string }[];
      };
      expect(body.integrations).toHaveLength(2);
      expect(body.integrations[0]?.provider).toBe('google');
    });
  });

  describe('DELETE /api/account', () => {
    it('should return 400 without confirmation', async () => {
      const res = await app.request('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it('should return 400 with wrong confirmation', async () => {
      const res = await app.request('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'wrong' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Invalid confirmation');
    });

    it('should delete account with correct confirmation', async () => {
      const res = await app.request('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'DELETE_MY_ACCOUNT' }),
      });

      expect(res.status).toBe(204);
    });
  });

  describe('Edge Cases', () => {
    describe('GET /api/account edge cases', () => {
      it('should return account overview with zero stats', async () => {
        const mockUser = {
          id: 'test-user-id',
          name: 'New User',
          email: 'new@example.com',
          emailVerified: true,
          image: null,
          createdAt: new Date('2026-01-01'),
        };
        mockDb.query.users.findFirst.mockResolvedValue(mockUser);
        mockDb.query.initiatives.findMany.mockResolvedValue([]);
        mockDb.query.projects.findMany.mockResolvedValue([]);
        mockDb.query.tasks.findMany.mockResolvedValue([]);
        mockDb.query.events.findMany.mockResolvedValue([]);

        const res = await app.request('/api/account');
        expect(res.status).toBe(200);

        const body = (await res.json()) as {
          data: {
            id: string;
            name: string;
            image: string | null;
            stats: {
              initiatives: number;
              projects: number;
              tasks: number;
              events: number;
            };
          };
        };
        expect(body.data.id).toBe('test-user-id');
        expect(body.data.image).toBeNull();
        expect(body.data.stats.initiatives).toBe(0);
        expect(body.data.stats.projects).toBe(0);
        expect(body.data.stats.tasks).toBe(0);
        expect(body.data.stats.events).toBe(0);
      });

      it('should return account overview with unverified email', async () => {
        const mockUser = {
          id: 'test-user-id',
          name: 'Unverified User',
          email: 'unverified@example.com',
          emailVerified: false,
          image: null,
          createdAt: new Date('2026-01-01'),
        };
        mockDb.query.users.findFirst.mockResolvedValue(mockUser);
        mockDb.query.initiatives.findMany.mockResolvedValue([]);
        mockDb.query.projects.findMany.mockResolvedValue([]);
        mockDb.query.tasks.findMany.mockResolvedValue([]);
        mockDb.query.events.findMany.mockResolvedValue([]);

        const res = await app.request('/api/account');
        expect(res.status).toBe(200);

        const body = (await res.json()) as {
          data: {
            emailVerified: boolean;
          };
        };
        expect(body.data.emailVerified).toBe(false);
      });

      it('should handle user with null name', async () => {
        const mockUser = {
          id: 'test-user-id',
          name: null,
          email: 'anon@example.com',
          emailVerified: true,
          image: null,
          createdAt: new Date('2026-01-01'),
        };
        mockDb.query.users.findFirst.mockResolvedValue(mockUser);
        mockDb.query.initiatives.findMany.mockResolvedValue([]);
        mockDb.query.projects.findMany.mockResolvedValue([]);
        mockDb.query.tasks.findMany.mockResolvedValue([]);
        mockDb.query.events.findMany.mockResolvedValue([]);

        const res = await app.request('/api/account');
        expect(res.status).toBe(200);

        const body = (await res.json()) as {
          data: {
            name: string | null;
          };
        };
        expect(body.data.name).toBeNull();
      });
    });

    describe('GET /api/account/export edge cases', () => {
      it('should export with user settings included', async () => {
        const mockUser = {
          id: 'test-user-id',
          name: 'Test User',
          email: 'test@example.com',
          createdAt: new Date('2025-01-01'),
        };
        mockDb.query.users.findFirst.mockResolvedValue(mockUser);
        mockDb.query.initiatives.findMany.mockResolvedValue([]);
        mockDb.query.projects.findMany.mockResolvedValue([]);
        mockDb.query.tasks.findMany.mockResolvedValue([]);
        mockDb.query.events.findMany.mockResolvedValue([]);
        mockDb.query.moments.findMany.mockResolvedValue([]);
        mockDb.query.activityStreams.findMany.mockResolvedValue([]);
        mockDb.query.tags.findMany.mockResolvedValue([]);
        mockDb.query.timeEntries.findMany.mockResolvedValue([]);
        mockDb.query.workspaces.findMany.mockResolvedValue([]);
        mockDb.query.userSettings.findFirst.mockResolvedValue({
          id: 'settings-1',
          userId: 'test-user-id',
          theme: 'dark',
          timezone: 'America/New_York',
          locale: 'en-US',
          defaultView: 'agenda',
        });
        mockDb.query.subscriptions.findFirst.mockResolvedValue(null);
        mockDb.query.linkedIntegrations.findMany.mockResolvedValue([]);

        const res = await app.request('/api/account/export');
        expect(res.status).toBe(200);

        const body = (await res.json()) as {
          settings: {
            theme: string;
            timezone: string;
          };
        };
        expect(body.settings.theme).toBe('dark');
        expect(body.settings.timezone).toBe('America/New_York');
      });

      it('should export with moments and activity streams', async () => {
        const mockUser = {
          id: 'test-user-id',
          name: 'Test User',
          email: 'test@example.com',
          createdAt: new Date(),
        };
        mockDb.query.users.findFirst.mockResolvedValue(mockUser);
        mockDb.query.initiatives.findMany.mockResolvedValue([]);
        mockDb.query.projects.findMany.mockResolvedValue([]);
        mockDb.query.tasks.findMany.mockResolvedValue([]);
        mockDb.query.events.findMany.mockResolvedValue([]);
        mockDb.query.moments.findMany.mockResolvedValue([
          {
            id: 'moment-1',
            label: 'Q1 Planning',
            startTime: new Date('2026-01-01'),
            endTime: new Date('2026-03-31'),
          },
        ]);
        mockDb.query.activityStreams.findMany.mockResolvedValue([
          {
            id: 'stream-1',
            name: 'GitHub Activity',
            source: 'github',
            activities: [{ id: 'activity-1', type: 'commit' }],
          },
        ]);
        mockDb.query.tags.findMany.mockResolvedValue([]);
        mockDb.query.timeEntries.findMany.mockResolvedValue([]);
        mockDb.query.workspaces.findMany.mockResolvedValue([]);
        mockDb.query.userSettings.findFirst.mockResolvedValue(null);
        mockDb.query.subscriptions.findFirst.mockResolvedValue(null);
        mockDb.query.linkedIntegrations.findMany.mockResolvedValue([]);

        const res = await app.request('/api/account/export');
        expect(res.status).toBe(200);

        const body = (await res.json()) as {
          data: {
            moments: { id: string; label: string }[];
            activityStreams: { id: string; name: string }[];
          };
        };
        expect(body.data.moments).toHaveLength(1);
        expect(body.data.moments[0]?.label).toBe('Q1 Planning');
        expect(body.data.activityStreams).toHaveLength(1);
        expect(body.data.activityStreams[0]?.name).toBe('GitHub Activity');
      });

      it('should export with time entries and workspaces', async () => {
        const mockUser = {
          id: 'test-user-id',
          name: 'Test User',
          email: 'test@example.com',
          createdAt: new Date(),
        };
        mockDb.query.users.findFirst.mockResolvedValue(mockUser);
        mockDb.query.initiatives.findMany.mockResolvedValue([]);
        mockDb.query.projects.findMany.mockResolvedValue([]);
        mockDb.query.tasks.findMany.mockResolvedValue([]);
        mockDb.query.events.findMany.mockResolvedValue([]);
        mockDb.query.moments.findMany.mockResolvedValue([]);
        mockDb.query.activityStreams.findMany.mockResolvedValue([]);
        mockDb.query.tags.findMany.mockResolvedValue([]);
        mockDb.query.timeEntries.findMany.mockResolvedValue([
          {
            id: 'entry-1',
            taskId: 'task-1',
            startTime: new Date('2026-01-05T09:00:00Z'),
            endTime: new Date('2026-01-05T10:30:00Z'),
            description: 'Working on feature',
          },
        ]);
        mockDb.query.workspaces.findMany.mockResolvedValue([
          {
            id: 'workspace-1',
            name: 'Personal',
            description: 'Personal projects',
          },
          {
            id: 'workspace-2',
            name: 'Work',
            description: 'Work projects',
          },
        ]);
        mockDb.query.userSettings.findFirst.mockResolvedValue(null);
        mockDb.query.subscriptions.findFirst.mockResolvedValue(null);
        mockDb.query.linkedIntegrations.findMany.mockResolvedValue([]);

        const res = await app.request('/api/account/export');
        expect(res.status).toBe(200);

        const body = (await res.json()) as {
          data: {
            timeEntries: { id: string }[];
            workspaces: { id: string; name: string }[];
          };
        };
        expect(body.data.timeEntries).toHaveLength(1);
        expect(body.data.workspaces).toHaveLength(2);
        expect(body.data.workspaces[0]?.name).toBe('Personal');
      });

      it('should export with all data types populated', async () => {
        const mockUser = {
          id: 'test-user-id',
          name: 'Power User',
          email: 'power@example.com',
          createdAt: new Date('2025-01-01'),
        };
        mockDb.query.users.findFirst.mockResolvedValue(mockUser);
        mockDb.query.initiatives.findMany.mockResolvedValue([
          { id: 'init-1', name: 'Q1 Goals' },
          { id: 'init-2', name: 'Q2 Goals' },
        ]);
        mockDb.query.projects.findMany.mockResolvedValue([
          { id: 'proj-1', name: 'Website Redesign' },
        ]);
        mockDb.query.tasks.findMany.mockResolvedValue([
          { id: 'task-1', title: 'Design mockups' },
          { id: 'task-2', title: 'Implement frontend' },
        ]);
        mockDb.query.events.findMany.mockResolvedValue([{ id: 'event-1', title: 'Team Meeting' }]);
        mockDb.query.moments.findMany.mockResolvedValue([{ id: 'moment-1', label: 'Sprint 1' }]);
        mockDb.query.activityStreams.findMany.mockResolvedValue([
          { id: 'stream-1', name: 'GitHub' },
        ]);
        mockDb.query.tags.findMany.mockResolvedValue([
          { id: 'tag-1', name: 'urgent' },
          { id: 'tag-2', name: 'design' },
        ]);
        mockDb.query.timeEntries.findMany.mockResolvedValue([
          { id: 'entry-1', description: 'Coding' },
        ]);
        mockDb.query.workspaces.findMany.mockResolvedValue([{ id: 'ws-1', name: 'Main' }]);
        mockDb.query.userSettings.findFirst.mockResolvedValue({
          theme: 'light',
        });
        mockDb.query.subscriptions.findFirst.mockResolvedValue({
          planTier: 'pro',
          status: 'active',
        });
        mockDb.query.linkedIntegrations.findMany.mockResolvedValue([
          { provider: 'google', createdAt: new Date() },
        ]);

        const res = await app.request('/api/account/export');
        expect(res.status).toBe(200);

        const body = (await res.json()) as {
          exportVersion: string;
          user: { name: string };
          settings: { theme: string };
          subscription: { planTier: string };
          data: {
            initiatives: unknown[];
            projects: unknown[];
            tasks: unknown[];
            events: unknown[];
            moments: unknown[];
            activityStreams: unknown[];
            tags: unknown[];
            timeEntries: unknown[];
            workspaces: unknown[];
          };
          integrations: unknown[];
          schema: Record<string, unknown>;
        };

        expect(body.exportVersion).toBe('2.0.0');
        expect(body.user.name).toBe('Power User');
        expect(body.settings.theme).toBe('light');
        expect(body.subscription.planTier).toBe('pro');
        expect(body.data.initiatives).toHaveLength(2);
        expect(body.data.projects).toHaveLength(1);
        expect(body.data.tasks).toHaveLength(2);
        expect(body.data.events).toHaveLength(1);
        expect(body.data.moments).toHaveLength(1);
        expect(body.data.activityStreams).toHaveLength(1);
        expect(body.data.tags).toHaveLength(2);
        expect(body.data.timeEntries).toHaveLength(1);
        expect(body.data.workspaces).toHaveLength(1);
        expect(body.integrations).toHaveLength(1);
        expect(body.schema).toBeDefined();
      });

      it('should set correct content disposition header', async () => {
        const mockUser = {
          id: 'test-user-id',
          name: 'Test User',
          email: 'test@example.com',
          createdAt: new Date(),
        };
        mockDb.query.users.findFirst.mockResolvedValue(mockUser);
        mockDb.query.initiatives.findMany.mockResolvedValue([]);
        mockDb.query.projects.findMany.mockResolvedValue([]);
        mockDb.query.tasks.findMany.mockResolvedValue([]);
        mockDb.query.events.findMany.mockResolvedValue([]);
        mockDb.query.moments.findMany.mockResolvedValue([]);
        mockDb.query.activityStreams.findMany.mockResolvedValue([]);
        mockDb.query.tags.findMany.mockResolvedValue([]);
        mockDb.query.timeEntries.findMany.mockResolvedValue([]);
        mockDb.query.workspaces.findMany.mockResolvedValue([]);
        mockDb.query.userSettings.findFirst.mockResolvedValue(null);
        mockDb.query.subscriptions.findFirst.mockResolvedValue(null);
        mockDb.query.linkedIntegrations.findMany.mockResolvedValue([]);

        const res = await app.request('/api/account/export');
        expect(res.status).toBe(200);

        const contentType = res.headers.get('Content-Type');
        const contentDisposition = res.headers.get('Content-Disposition');

        expect(contentType).toContain('application/json');
        expect(contentDisposition).toContain('attachment');
        expect(contentDisposition).toContain('athena-export-');
        expect(contentDisposition).toContain('.json');
      });
    });

    describe('DELETE /api/account edge cases', () => {
      it('should reject partial confirmation string', async () => {
        const res = await app.request('/api/account', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmation: 'DELETE_MY' }),
        });

        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain('Invalid confirmation');
      });

      it('should reject lowercase confirmation', async () => {
        const res = await app.request('/api/account', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmation: 'delete_my_account' }),
        });

        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain('Invalid confirmation');
      });

      it('should reject confirmation with extra whitespace', async () => {
        const res = await app.request('/api/account', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmation: ' DELETE_MY_ACCOUNT ' }),
        });

        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain('Invalid confirmation');
      });
    });
  });
});
