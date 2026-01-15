/**
 * Calendar sync API integration tests.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetMockDb, type MockDb } from './test-utils.js';
import {
  createCalendarConnectionFixture,
  createSyncedCalendarFixture,
  createSyncResultFixture,
  createFailedSyncResultFixture,
} from '@athena/test-utils/fixtures';

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
    plugins: [],
  },
}));

vi.mock('../../src/lib/oauth-resource-client.js', () => ({
  serverClient: {
    verifyAccessToken: vi.fn(),
  },
  verifyAccessToken: vi.fn(),
}));

// Mock calendar sync service
const mockCalendarSyncService = vi.hoisted(() => ({
  getConnections: vi.fn(),
  getAuthUrl: vi.fn(),
  handleOAuthCallback: vi.fn(),
  updateSyncSettings: vi.fn(),
  updateAccountSettings: vi.fn(),
  reorderAccounts: vi.fn(),
  sync: vi.fn(),
  pushEvent: vi.fn(),
  pushEventDelete: vi.fn(),
  pushEventToAllConnections: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock('../../src/services/calendar-sync/index.js', () => ({
  getCalendarSyncService: () => mockCalendarSyncService,
}));

import { app } from '../../src/index.js';

describe('Calendar Sync API', () => {
  beforeEach(() => {
    resetMockDb(mockDb);
    vi.clearAllMocks();
  });

  describe('GET /api/calendar-sync/connections', () => {
    it('should return empty list when no connections exist', async () => {
      mockCalendarSyncService.getConnections.mockResolvedValue([]);

      const res = await app.request('/api/calendar-sync/connections');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { success: boolean; data: unknown[] };
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });

    it('should return list of calendar connections', async () => {
      const googleConnection = createCalendarConnectionFixture({
        id: 'conn-1',
        provider: 'google',
        accountLabel: 'Personal Gmail',
        isPrimary: true,
        displayOrder: 0,
        calendars: [
          createSyncedCalendarFixture({
            id: 'cal-1',
            externalId: 'primary@gmail.com',
            name: 'Primary',
            isPrimary: true,
            syncDirection: 'bidirectional',
          }),
        ],
      });

      const outlookConnection = createCalendarConnectionFixture({
        id: 'conn-2',
        provider: 'outlook',
        accountLabel: 'Work',
        isPrimary: false,
        displayOrder: 1,
        calendars: [
          createSyncedCalendarFixture({
            id: 'cal-2',
            name: 'Calendar',
            syncDirection: 'pull',
          }),
        ],
      });

      const mockConnections = [googleConnection, outlookConnection];
      mockCalendarSyncService.getConnections.mockResolvedValue(mockConnections);

      const res = await app.request('/api/calendar-sync/connections');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { success: boolean; data: typeof mockConnections };
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(2);
      expect(body.data[0]?.provider).toBe('google');
      expect(body.data[1]?.provider).toBe('outlook');
    });
  });

  describe('GET /api/calendar-sync/auth/:provider', () => {
    it('should return auth URL for google provider', async () => {
      mockCalendarSyncService.getAuthUrl.mockReturnValue(
        'https://accounts.google.com/o/oauth2/v2/auth?client_id=...',
      );

      const res = await app.request('/api/calendar-sync/auth/google');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { success: boolean; data: { authUrl: string } };
      expect(body.success).toBe(true);
      expect(body.data.authUrl).toContain('accounts.google.com');
    });

    it('should return auth URL for outlook provider', async () => {
      mockCalendarSyncService.getAuthUrl.mockReturnValue(
        'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=...',
      );

      const res = await app.request('/api/calendar-sync/auth/outlook');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { success: boolean; data: { authUrl: string } };
      expect(body.success).toBe(true);
      expect(body.data.authUrl).toContain('login.microsoftonline.com');
    });

    it('should return 400 for invalid provider', async () => {
      const res = await app.request('/api/calendar-sync/auth/invalid');
      expect(res.status).toBe(400);
    });

    it('should return 400 when auth URL generation fails', async () => {
      mockCalendarSyncService.getAuthUrl.mockImplementation(() => {
        throw new Error('Provider not configured');
      });

      const res = await app.request('/api/calendar-sync/auth/google');
      expect(res.status).toBe(400);

      const body = (await res.json()) as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe('Failed to get auth URL');
    });
  });

  describe('POST /api/calendar-sync/callback', () => {
    it('should return 400 when state cookie is missing', async () => {
      const res = await app.request('/api/calendar-sync/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          code: 'auth-code-123',
          state: 'some-state-token',
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe('Invalid state token');
    });
  });

  describe('PATCH /api/calendar-sync/connections/:id/settings', () => {
    it('should update sync settings', async () => {
      mockCalendarSyncService.updateSyncSettings.mockResolvedValue(undefined);

      const res = await app.request('/api/calendar-sync/connections/conn-1/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calendars: [
            {
              id: 'cal-1',
              syncEnabled: true,
              syncDirection: 'bidirectional',
            },
            {
              id: 'cal-2',
              syncEnabled: false,
              syncDirection: 'pull',
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
      expect(mockCalendarSyncService.updateSyncSettings).toHaveBeenCalledWith(
        'conn-1',
        'test-user-id',
        [
          { id: 'cal-1', syncEnabled: true, syncDirection: 'bidirectional' },
          { id: 'cal-2', syncEnabled: false, syncDirection: 'pull' },
        ],
      );
    });

    it('should return 400 when update fails', async () => {
      mockCalendarSyncService.updateSyncSettings.mockRejectedValue(
        new Error('Connection not found'),
      );

      const res = await app.request('/api/calendar-sync/connections/conn-1/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calendars: [{ id: 'cal-1', syncEnabled: true, syncDirection: 'bidirectional' }],
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe('Failed to update settings');
    });

    it('should reject invalid sync direction', async () => {
      const res = await app.request('/api/calendar-sync/connections/conn-1/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calendars: [{ id: 'cal-1', syncEnabled: true, syncDirection: 'invalid' }],
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/calendar-sync/connections/:id/account', () => {
    it('should update account label', async () => {
      mockCalendarSyncService.updateAccountSettings.mockResolvedValue(undefined);

      const res = await app.request('/api/calendar-sync/connections/conn-1/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountLabel: 'Work Gmail' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('should update account color', async () => {
      mockCalendarSyncService.updateAccountSettings.mockResolvedValue(undefined);

      const res = await app.request('/api/calendar-sync/connections/conn-1/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountColor: '#ff5733' }),
      });

      expect(res.status).toBe(200);
    });

    it('should update primary status', async () => {
      mockCalendarSyncService.updateAccountSettings.mockResolvedValue(undefined);

      const res = await app.request('/api/calendar-sync/connections/conn-1/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPrimary: true }),
      });

      expect(res.status).toBe(200);
    });

    it('should reject invalid color format', async () => {
      const res = await app.request('/api/calendar-sync/connections/conn-1/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountColor: 'not-a-color' }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/calendar-sync/connections/reorder', () => {
    it('should reorder connections', async () => {
      mockCalendarSyncService.reorderAccounts.mockResolvedValue(undefined);

      const res = await app.request('/api/calendar-sync/connections/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionIds: [
            '550e8400-e29b-41d4-a716-446655440001',
            '550e8400-e29b-41d4-a716-446655440000',
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('should reject invalid UUIDs', async () => {
      const res = await app.request('/api/calendar-sync/connections/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionIds: ['not-a-uuid', 'also-not-a-uuid'] }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/calendar-sync/connections/:id/sync', () => {
    it('should trigger sync and return results', async () => {
      const syncResult = createSyncResultFixture({
        success: true,
        eventsCreated: 5,
        eventsUpdated: 2,
        eventsDeleted: 1,
        errors: [],
      });
      mockCalendarSyncService.sync.mockResolvedValue(syncResult);

      const res = await app.request('/api/calendar-sync/connections/conn-1/sync', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: { eventsCreated: number; eventsUpdated: number; eventsDeleted: number };
      };
      expect(body.success).toBe(true);
      expect(body.data.eventsCreated).toBe(5);
      expect(body.data.eventsUpdated).toBe(2);
      expect(body.data.eventsDeleted).toBe(1);
    });

    it('should return partial success with errors', async () => {
      const failedSyncResult = createFailedSyncResultFixture(1, {
        eventsCreated: 3,
        eventsUpdated: 0,
        eventsDeleted: 0,
      });
      mockCalendarSyncService.sync.mockResolvedValue(failedSyncResult);

      const res = await app.request('/api/calendar-sync/connections/conn-1/sync', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: { errors: unknown[] } };
      expect(body.success).toBe(false);
      expect(body.data.errors).toHaveLength(1);
    });

    it('should return 500 when sync throws', async () => {
      mockCalendarSyncService.sync.mockRejectedValue(new Error('Connection not found'));

      const res = await app.request('/api/calendar-sync/connections/conn-1/sync', {
        method: 'POST',
      });

      expect(res.status).toBe(500);
      const body = (await res.json()) as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe('Sync failed');
    });
  });

  describe('POST /api/calendar-sync/connections/:id/push', () => {
    it('should push event to external calendar', async () => {
      mockCalendarSyncService.pushEvent.mockResolvedValue(undefined);

      const res = await app.request('/api/calendar-sync/connections/conn-1/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: '550e8400-e29b-41d4-a716-446655440000' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('should return 500 when push fails', async () => {
      mockCalendarSyncService.pushEvent.mockRejectedValue(new Error('External API error'));

      const res = await app.request('/api/calendar-sync/connections/conn-1/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: '550e8400-e29b-41d4-a716-446655440000' }),
      });

      expect(res.status).toBe(500);
      const body = (await res.json()) as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe('Push failed');
    });

    it('should reject invalid event ID', async () => {
      const res = await app.request('/api/calendar-sync/connections/conn-1/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: 'not-a-uuid' }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/calendar-sync/connections/:id/events/:eventId', () => {
    it('should sync event to external calendar', async () => {
      mockCalendarSyncService.pushEvent.mockResolvedValue(undefined);

      const res = await app.request(
        '/api/calendar-sync/connections/conn-1/events/550e8400-e29b-41d4-a716-446655440000',
        { method: 'PUT' },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('should return 500 when sync fails', async () => {
      mockCalendarSyncService.pushEvent.mockRejectedValue(new Error('Event not found'));

      const res = await app.request(
        '/api/calendar-sync/connections/conn-1/events/550e8400-e29b-41d4-a716-446655440000',
        { method: 'PUT' },
      );

      expect(res.status).toBe(500);
    });
  });

  describe('DELETE /api/calendar-sync/connections/:id/events/:eventId', () => {
    it('should delete event from external calendar', async () => {
      mockCalendarSyncService.pushEventDelete.mockResolvedValue(undefined);

      const res = await app.request(
        '/api/calendar-sync/connections/conn-1/events/550e8400-e29b-41d4-a716-446655440000',
        { method: 'DELETE' },
      );

      expect(res.status).toBe(204);
    });

    it('should return 500 when delete fails', async () => {
      mockCalendarSyncService.pushEventDelete.mockRejectedValue(
        new Error('External event not found'),
      );

      const res = await app.request(
        '/api/calendar-sync/connections/conn-1/events/550e8400-e29b-41d4-a716-446655440000',
        { method: 'DELETE' },
      );

      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/calendar-sync/sync-all', () => {
    it('should sync all connections successfully', async () => {
      const mockConnections = [
        createCalendarConnectionFixture({ id: 'conn-1', provider: 'google' }),
        createCalendarConnectionFixture({ id: 'conn-2', provider: 'outlook' }),
      ];
      mockCalendarSyncService.getConnections.mockResolvedValue(mockConnections);

      const syncResult1 = createSyncResultFixture({
        eventsCreated: 3,
        eventsUpdated: 1,
        eventsDeleted: 0,
      });
      const syncResult2 = createSyncResultFixture({
        eventsCreated: 2,
        eventsUpdated: 0,
        eventsDeleted: 1,
      });
      mockCalendarSyncService.sync
        .mockResolvedValueOnce(syncResult1)
        .mockResolvedValueOnce(syncResult2);

      const res = await app.request('/api/calendar-sync/sync-all', { method: 'POST' });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: { connectionId: string; success: boolean }[];
      };
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(2);
      expect(body.data[0]?.success).toBe(true);
      expect(body.data[1]?.success).toBe(true);
    });

    it('should handle partial failures', async () => {
      const mockConnections = [
        createCalendarConnectionFixture({ id: 'conn-1', provider: 'google' }),
        createCalendarConnectionFixture({ id: 'conn-2', provider: 'outlook' }),
      ];
      mockCalendarSyncService.getConnections.mockResolvedValue(mockConnections);

      const syncResult = createSyncResultFixture({
        eventsCreated: 3,
        eventsUpdated: 1,
        eventsDeleted: 0,
      });
      mockCalendarSyncService.sync
        .mockResolvedValueOnce(syncResult)
        .mockRejectedValueOnce(new Error('Token expired'));

      const res = await app.request('/api/calendar-sync/sync-all', { method: 'POST' });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: { connectionId: string; success: boolean }[];
      };
      expect(body.success).toBe(false);
      expect(body.data[0]?.success).toBe(true);
      expect(body.data[1]?.success).toBe(false);
    });

    it('should return empty results when no connections', async () => {
      mockCalendarSyncService.getConnections.mockResolvedValue([]);

      const res = await app.request('/api/calendar-sync/sync-all', { method: 'POST' });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown[] };
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(0);
    });
  });

  describe('PUT /api/calendar-sync/events/:eventId', () => {
    it('should push event to all bidirectional connections', async () => {
      mockCalendarSyncService.pushEventToAllConnections.mockResolvedValue(undefined);

      const res = await app.request(
        '/api/calendar-sync/events/550e8400-e29b-41d4-a716-446655440000',
        { method: 'PUT' },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
      expect(mockCalendarSyncService.pushEventToAllConnections).toHaveBeenCalledWith(
        'test-user-id',
        '550e8400-e29b-41d4-a716-446655440000',
        'update',
      );
    });

    it('should return 500 when push fails', async () => {
      mockCalendarSyncService.pushEventToAllConnections.mockRejectedValue(
        new Error('Event not found'),
      );

      const res = await app.request(
        '/api/calendar-sync/events/550e8400-e29b-41d4-a716-446655440000',
        { method: 'PUT' },
      );

      expect(res.status).toBe(500);
    });
  });

  describe('DELETE /api/calendar-sync/events/:eventId', () => {
    it('should delete event from all bidirectional connections', async () => {
      mockCalendarSyncService.pushEventToAllConnections.mockResolvedValue(undefined);

      const res = await app.request(
        '/api/calendar-sync/events/550e8400-e29b-41d4-a716-446655440000',
        { method: 'DELETE' },
      );

      expect(res.status).toBe(204);
      expect(mockCalendarSyncService.pushEventToAllConnections).toHaveBeenCalledWith(
        'test-user-id',
        '550e8400-e29b-41d4-a716-446655440000',
        'delete',
      );
    });

    it('should return 500 when delete fails', async () => {
      mockCalendarSyncService.pushEventToAllConnections.mockRejectedValue(
        new Error('Connection error'),
      );

      const res = await app.request(
        '/api/calendar-sync/events/550e8400-e29b-41d4-a716-446655440000',
        { method: 'DELETE' },
      );

      expect(res.status).toBe(500);
    });
  });

  describe('DELETE /api/calendar-sync/connections/:id', () => {
    it('should disconnect calendar provider', async () => {
      mockCalendarSyncService.disconnect.mockResolvedValue(undefined);

      const res = await app.request('/api/calendar-sync/connections/conn-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);
      expect(mockCalendarSyncService.disconnect).toHaveBeenCalledWith('conn-1', 'test-user-id');
    });

    it('should return 500 when disconnect fails', async () => {
      mockCalendarSyncService.disconnect.mockRejectedValue(new Error('Connection not found'));

      const res = await app.request('/api/calendar-sync/connections/conn-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(500);
      const body = (await res.json()) as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe('Disconnect failed');
    });
  });
});
