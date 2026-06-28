/**
 * Calendar Sync Service Unit Tests
 *
 * Tests for the calendar sync service methods including:
 * - Connection management
 * - Sync operations (pull/push)
 * - Conflict detection
 * - External ID mapping
 *
 * @packageDocumentation
 */

import type { Mock } from 'vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetMockDb, type MockDb } from '../../integration/test-utils.js';
import type { CalendarProviderClient } from '../../../src/services/calendar-sync/types.js';

// Mock database
const mockDb = vi.hoisted((): MockDb => {
  const factory = (globalThis as { __athenaMockDbFactory?: () => MockDb }).__athenaMockDbFactory;
  if (!factory) {
    throw new Error('Mock DB factory not initialized');
  }
  return factory();
});

// Type for mock mapping service methods
interface MockMappingService {
  findByExternalId: Mock;
  findByLocalEntity: Mock;
  createMapping: Mock;
  markSyncedFromExternal: Mock;
  markSyncedToExternal: Mock;
  deleteMapping: Mock;
  getMappingsForIntegration: Mock;
  getOrCreateMapping: Mock;
  updateExternalVersion: Mock;
}

// Mock mapping service
const mockMappingService = vi.hoisted((): MockMappingService => ({
  findByExternalId: vi.fn(),
  findByLocalEntity: vi.fn(),
  createMapping: vi.fn(),
  markSyncedFromExternal: vi.fn(),
  markSyncedToExternal: vi.fn(),
  deleteMapping: vi.fn(),
  getMappingsForIntegration: vi.fn(),
  getOrCreateMapping: vi.fn(),
  updateExternalVersion: vi.fn(),
}));

// Type for mock provider with vitest mocks
interface MockCalendarProvider {
  provider: CalendarProviderClient['provider'];
  getAuthUrl: Mock;
  exchangeCode: Mock;
  refreshToken: Mock;
  listCalendars: Mock;
  getEvents: Mock;
  createEvent: Mock;
  updateEvent: Mock;
  deleteEvent: Mock;
  getUserEmail: Mock;
}

// Mock providers - use vi.hoisted to ensure mocks are available during module hoisting
const { mockGoogleProvider, mockOutlookProvider, MockGoogleCalendarProvider, MockOutlookCalendarProvider } = vi.hoisted(() => {
  const mockGoogleProvider: MockCalendarProvider = {
    provider: 'google' as const,
    getAuthUrl: vi.fn(),
    exchangeCode: vi.fn(),
    refreshToken: vi.fn(),
    listCalendars: vi.fn(),
    getEvents: vi.fn(),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    getUserEmail: vi.fn(),
  };

  const mockOutlookProvider: MockCalendarProvider = {
    provider: 'outlook' as const,
    getAuthUrl: vi.fn(),
    exchangeCode: vi.fn(),
    refreshToken: vi.fn(),
    listCalendars: vi.fn(),
    getEvents: vi.fn(),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    getUserEmail: vi.fn(),
  };

  // Create mock classes that can be used with 'new'
  const MockGoogleCalendarProvider = vi.fn(function (this: MockCalendarProvider) {
    return mockGoogleProvider;
  });

  const MockOutlookCalendarProvider = vi.fn(function (this: MockCalendarProvider) {
    return mockOutlookProvider;
  });

  return { mockGoogleProvider, mockOutlookProvider, MockGoogleCalendarProvider, MockOutlookCalendarProvider };
});

// Mock encryption
const mockDecryptSecret = vi.hoisted((): Mock<(val: string | null) => string | null> => vi.fn((val: string | null) => val));

vi.mock('../../../src/db/index.js', () => ({ db: mockDb }));

vi.mock('../../../src/services/sync/mapping-service.js', () => ({
  getMappingService: () => mockMappingService,
  MappingService: vi.fn(() => mockMappingService),
}));

vi.mock('../../../src/services/calendar-sync/providers/google.js', () => ({
  GoogleCalendarProvider: MockGoogleCalendarProvider,
}));

vi.mock('../../../src/services/calendar-sync/providers/outlook.js', () => ({
  OutlookCalendarProvider: MockOutlookCalendarProvider,
}));

vi.mock('../../../src/lib/crypto.js', () => ({
  decryptSecret: mockDecryptSecret,
  decryptSecretOptional: mockDecryptSecret,
  encryptSecret: vi.fn((val: string) => val),
}));

vi.mock('../../../src/lib/env.js', () => ({
  env: {
    googleCalendar: {
      clientId: 'test-google-client-id',
      clientSecret: 'test-google-client-secret',
      redirectUri: 'http://localhost:3000/callback/google',
    },
    outlookCalendar: {
      clientId: 'test-outlook-client-id',
      clientSecret: 'test-outlook-client-secret',
      redirectUri: 'http://localhost:3000/callback/outlook',
    },
    FRONTEND_URL: 'http://localhost:3000',
  },
}));

// Import after mocks
import type { CalendarSyncService } from '../../../src/services/calendar-sync/service.js';
import { createCalendarSyncService } from '../../../src/services/calendar-sync/service.js';

describe('CalendarSyncService', () => {
  let service: CalendarSyncService;
  const testUserId = 'user-123';
  const testConnectionId = 'connection-456';

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockDb(mockDb);
    service = createCalendarSyncService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getConnections', () => {
    it('should return empty array when user has no connections', async () => {
      mockDb.query.linkedIntegrations.findMany.mockResolvedValue([]);

      const connections = await service.getConnections(testUserId);

      expect(connections).toEqual([]);
      expect(mockDb.query.linkedIntegrations.findMany).toHaveBeenCalled();
    });

    it('should return formatted connections for user', async () => {
      const mockIntegration = {
        id: testConnectionId,
        userId: testUserId,
        provider: 'google_calendar',
        externalAccountId: 'ext-123',
        accessToken: 'encrypted-token',
        refreshToken: 'encrypted-refresh',
        tokenExpiresAt: new Date(Date.now() + 3600000),
        syncEnabled: true,
        lastSyncAt: new Date(),
        lastSyncStatus: 'success',
        // jsonb columns are parsed as objects by Drizzle, not strings
        metadata: {
          calendars: [
            {
              id: 'cal-1',
              externalId: 'primary',
              name: 'Primary',
              isPrimary: true,
              syncEnabled: true,
              syncDirection: 'bidirectional',
            },
          ],
          accountLabel: 'Work',
          accountEmail: 'work@example.com',
          isPrimary: true,
          displayOrder: 0,
        },
        accountLabel: 'Work',
        accountEmail: 'work@example.com',
        isPrimary: true,
        displayOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.query.linkedIntegrations.findMany.mockResolvedValue([mockIntegration]);

      const connections = await service.getConnections(testUserId);

      expect(connections).toHaveLength(1);
      expect(connections[0]).toMatchObject({
        id: testConnectionId,
        provider: 'google',
        syncEnabled: true,
        calendars: expect.arrayContaining([
          expect.objectContaining({
            name: 'Primary',
            syncDirection: 'bidirectional',
          }) as unknown,
        ]) as unknown,
      });
    });
  });

  describe('getAuthUrl', () => {
    it('should return Google auth URL', () => {
      const mockUrl = 'https://accounts.google.com/oauth?state=test';
      mockGoogleProvider.getAuthUrl.mockReturnValue(mockUrl);

      const result = service.getAuthUrl('google', 'test-state');

      expect(result).toBe(mockUrl);
      expect(mockGoogleProvider.getAuthUrl).toHaveBeenCalledWith('test-state');
    });

    it('should return Outlook auth URL', () => {
      const mockUrl = 'https://login.microsoftonline.com/oauth?state=test';
      mockOutlookProvider.getAuthUrl.mockReturnValue(mockUrl);

      const result = service.getAuthUrl('outlook', 'test-state');

      expect(result).toBe(mockUrl);
      expect(mockOutlookProvider.getAuthUrl).toHaveBeenCalledWith('test-state');
    });

    it('should throw for unsupported provider', () => {
      expect(() => service.getAuthUrl('unsupported' as never, 'state')).toThrow();
    });
  });

  describe('sync', () => {
    const mockIntegration = {
      id: testConnectionId,
      userId: testUserId,
      provider: 'google_calendar',
      accessToken: 'test-token',
      refreshToken: 'test-refresh',
      tokenExpiresAt: new Date(Date.now() + 3600000),
      metadata: {
        calendars: [
          {
            id: 'cal-1',
            externalId: 'primary',
            name: 'Primary',
            isPrimary: true,
            syncEnabled: true,
            syncDirection: 'bidirectional',
          },
        ],
      },
    };

    it('should sync events from external calendar', async () => {
      mockDb.query.linkedIntegrations.findFirst.mockResolvedValue(mockIntegration);
      mockGoogleProvider.getEvents.mockResolvedValue({
        events: [
          {
            externalId: 'event-1',
            calendarId: 'primary',
            title: 'Test Event',
            startTime: new Date(),
            endTime: new Date(),
            isAllDay: false,
            status: 'confirmed',
            visibility: 'public',
            etag: '"etag-123"',
          },
        ],
        nextSyncToken: 'sync-token-123',
      });
      mockMappingService.findByExternalId.mockResolvedValue(null);
      mockMappingService.createMapping.mockResolvedValue({ id: 'mapping-1' });

      const result = await service.sync(testConnectionId, testUserId);

      expect(result.success).toBe(true);
      expect(result.eventsCreated).toBeGreaterThanOrEqual(0);
    });

    it('should handle sync errors gracefully', async () => {
      mockDb.query.linkedIntegrations.findFirst.mockResolvedValue(null);

      await expect(service.sync(testConnectionId, testUserId)).rejects.toThrow();
    });
  });

  describe('pushEvent', () => {
    const mockIntegration = {
      id: testConnectionId,
      userId: testUserId,
      provider: 'google_calendar',
      accessToken: 'test-token',
      metadata: {
        calendars: [
          {
            id: 'cal-1',
            externalId: 'primary',
            name: 'Primary',
            isPrimary: true,
            syncEnabled: true,
            syncDirection: 'bidirectional',
          },
        ],
      },
    };

    const mockEvent = {
      id: 'event-local-1',
      title: 'Test Event',
      description: 'Test description',
      startTime: new Date(),
      endTime: new Date(),
      isAllDay: false,
      location: 'Test Location',
      creatorId: testUserId,
    };

    it('should create event in external calendar when no mapping exists', async () => {
      mockDb.query.linkedIntegrations.findFirst.mockResolvedValue(mockIntegration);
      mockDb.query.events.findFirst.mockResolvedValue(mockEvent);
      mockMappingService.findByLocalEntity.mockResolvedValue(null);
      mockGoogleProvider.createEvent.mockResolvedValue({
        externalId: 'ext-event-1',
        etag: '"new-etag"',
      });
      mockMappingService.createMapping.mockResolvedValue({ id: 'mapping-1' });

      const result = await service.pushEvent(testConnectionId, testUserId, mockEvent.id);

      expect(result).toBe('ext-event-1');
      expect(mockGoogleProvider.createEvent).toHaveBeenCalled();
      expect(mockMappingService.createMapping).toHaveBeenCalled();
    });

    it('should update existing event when mapping exists', async () => {
      const existingMapping = {
        id: 'mapping-1',
        externalId: 'ext-event-1',
        externalVersion: '"old-etag"',
        metadata: { calendarId: 'primary' },
      };

      mockDb.query.linkedIntegrations.findFirst.mockResolvedValue(mockIntegration);
      mockDb.query.events.findFirst.mockResolvedValue(mockEvent);
      mockMappingService.findByLocalEntity.mockResolvedValue(existingMapping);
      mockGoogleProvider.getEvents.mockResolvedValue({
        events: [{ externalId: 'ext-event-1', etag: '"old-etag"' }],
      });
      mockGoogleProvider.updateEvent.mockResolvedValue({
        externalId: 'ext-event-1',
        etag: '"updated-etag"',
      });

      const result = await service.pushEvent(testConnectionId, testUserId, mockEvent.id);

      expect(result).toBe('ext-event-1');
    });
  });

  describe('pushEventUpdate with conflict detection', () => {
    const mockIntegration = {
      id: testConnectionId,
      userId: testUserId,
      provider: 'google_calendar',
      accessToken: 'test-token',
      metadata: {
        calendars: [
          {
            id: 'cal-1',
            externalId: 'primary',
            name: 'Primary',
            isPrimary: true,
            syncEnabled: true,
            syncDirection: 'bidirectional',
          },
        ],
      },
    };

    const mockEvent = {
      id: 'event-local-1',
      title: 'Test Event',
      startTime: new Date(),
      endTime: new Date(),
      isAllDay: false,
      creatorId: testUserId,
    };

    it('should detect conflict when external ETag changed', async () => {
      const existingMapping = {
        id: 'mapping-1',
        externalId: 'ext-event-1',
        externalVersion: '"old-etag"',
        localEntityId: mockEvent.id,
        metadata: { calendarId: 'primary' },
      };

      mockDb.query.linkedIntegrations.findFirst.mockResolvedValue(mockIntegration);
      mockDb.query.events.findFirst.mockResolvedValue(mockEvent);
      mockMappingService.findByLocalEntity.mockResolvedValue(existingMapping);
      mockMappingService.findByExternalId.mockResolvedValue(existingMapping);

      // External event has different ETag - conflict!
      mockGoogleProvider.getEvents.mockResolvedValue({
        events: [
          {
            externalId: 'ext-event-1',
            calendarId: 'primary',
            title: 'Updated External Title',
            startTime: new Date(),
            endTime: new Date(),
            isAllDay: false,
            status: 'confirmed',
            visibility: 'public',
            etag: '"new-etag"', // Different from stored
          },
        ],
      });

      await service.pushEventUpdate(testConnectionId, testUserId, mockEvent.id);

      // Should sync from external instead of pushing
      expect(mockMappingService.markSyncedFromExternal).toHaveBeenCalled();
      // Should NOT call updateEvent since external wins
      expect(mockGoogleProvider.updateEvent).not.toHaveBeenCalled();
    });

    it('should push update when no conflict', async () => {
      const existingMapping = {
        id: 'mapping-1',
        externalId: 'ext-event-1',
        externalVersion: '"same-etag"',
        localEntityId: mockEvent.id,
        metadata: { calendarId: 'primary' },
      };

      mockDb.query.linkedIntegrations.findFirst.mockResolvedValue(mockIntegration);
      mockDb.query.events.findFirst.mockResolvedValue(mockEvent);
      mockMappingService.findByLocalEntity.mockResolvedValue(existingMapping);

      // External event has same ETag - no conflict
      mockGoogleProvider.getEvents.mockResolvedValue({
        events: [
          {
            externalId: 'ext-event-1',
            etag: '"same-etag"',
          },
        ],
      });
      mockGoogleProvider.updateEvent.mockResolvedValue({
        externalId: 'ext-event-1',
        etag: '"updated-etag"',
      });

      await service.pushEventUpdate(testConnectionId, testUserId, mockEvent.id);

      expect(mockGoogleProvider.updateEvent).toHaveBeenCalled();
      expect(mockMappingService.markSyncedToExternal).toHaveBeenCalled();
    });
  });

  describe('pushEventDelete', () => {
    it('should delete event from external calendar', async () => {
      const mockIntegration = {
        id: testConnectionId,
        userId: testUserId,
        provider: 'google_calendar',
        accessToken: 'test-token',
      };

      const existingMapping = {
        id: 'mapping-1',
        externalId: 'ext-event-1',
        metadata: { calendarId: 'primary' },
      };

      mockDb.query.linkedIntegrations.findFirst.mockResolvedValue(mockIntegration);
      mockMappingService.findByLocalEntity.mockResolvedValue(existingMapping);
      mockGoogleProvider.deleteEvent.mockResolvedValue(undefined);

      await service.pushEventDelete(testConnectionId, testUserId, 'event-local-1');

      expect(mockGoogleProvider.deleteEvent).toHaveBeenCalledWith(
        'test-token',
        'primary',
        'ext-event-1',
      );
      expect(mockMappingService.deleteMapping).toHaveBeenCalledWith('mapping-1');
    });

    it('should skip delete when no mapping exists', async () => {
      mockMappingService.findByLocalEntity.mockResolvedValue(null);

      await service.pushEventDelete(testConnectionId, testUserId, 'event-local-1');

      expect(mockGoogleProvider.deleteEvent).not.toHaveBeenCalled();
    });
  });

  describe('pushEventToAllConnections', () => {
    it('should push to all bidirectional connections', async () => {
      const mockEvent = {
        id: 'event-local-1',
        title: 'Test Event',
        startTime: new Date(),
        creatorId: testUserId,
        sourceIntegrationId: null,
      };

      const mockConnections = [
        {
          id: 'conn-1',
          userId: testUserId,
          provider: 'google_calendar',
          accessToken: 'token-1',
          metadata: {
            calendars: [
              { id: 'cal-1', externalId: 'primary', name: 'Primary', syncEnabled: true, syncDirection: 'bidirectional' },
            ],
          },
        },
        {
          id: 'conn-2',
          userId: testUserId,
          provider: 'outlook_calendar',
          accessToken: 'token-2',
          metadata: {
            calendars: [{ id: 'cal-2', externalId: 'calendar', name: 'Calendar', syncEnabled: true, syncDirection: 'pull' }],
          },
        },
      ];

      mockDb.query.events.findFirst.mockResolvedValue(mockEvent);
      mockDb.query.linkedIntegrations.findMany.mockResolvedValue(mockConnections);
      mockDb.query.linkedIntegrations.findFirst.mockImplementation(() => Promise.resolve(mockConnections[0]));
      mockMappingService.findByLocalEntity.mockResolvedValue(null);
      mockGoogleProvider.createEvent.mockResolvedValue({ externalId: 'ext-1', etag: '"etag"' });

      await service.pushEventToAllConnections(testUserId, mockEvent.id, 'create');

      // Should only push to bidirectional connection (conn-1), not pull-only (conn-2)
      expect(mockGoogleProvider.createEvent).toHaveBeenCalled();
    });

    it('should not push create when event is from external source', async () => {
      const mockEvent = {
        id: 'event-local-1',
        title: 'Test Event',
        startTime: new Date(),
        creatorId: testUserId,
        sourceIntegrationId: 'source-integration-1', // From external
      };

      mockDb.query.events.findFirst.mockResolvedValue(mockEvent);

      await service.pushEventToAllConnections(testUserId, mockEvent.id, 'create');

      // Should not push create for externally-sourced events
      expect(mockGoogleProvider.createEvent).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('should remove integration record', async () => {
      // disconnect() just deletes the linkedIntegrations record
      // It does not throw if the connection doesn't exist (delete just affects 0 rows)
      await service.disconnect(testConnectionId, testUserId);

      // Verify delete was called on linkedIntegrations
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should not throw when connection not found', async () => {
      // The implementation uses db.delete() which doesn't throw for non-existent records
      await expect(service.disconnect(testConnectionId, testUserId)).resolves.not.toThrow();
    });
  });
});
