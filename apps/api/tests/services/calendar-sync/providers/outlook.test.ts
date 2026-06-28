/**
 * Outlook Calendar Provider Unit Tests
 *
 * @packageDocumentation
 */

import type { Mock } from 'vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted mock setup for Microsoft Graph client
const { mockGraphApi, MockClient } = vi.hoisted(() => {
  // Single shared chainable mock for all API calls
  const mockGraphApi = {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };

  // Create chainable that always returns itself for method chaining
  const chainable = {
    select: vi.fn().mockReturnThis(),
    filter: vi.fn().mockReturnThis(),
    top: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    get: mockGraphApi.get,
    post: mockGraphApi.post,
    patch: mockGraphApi.patch,
    delete: mockGraphApi.delete,
  };

  // Make chainable methods return the chainable
  chainable.select.mockImplementation(() => chainable);
  chainable.filter.mockImplementation(() => chainable);
  chainable.top.mockImplementation(() => chainable);
  chainable.header.mockImplementation(() => chainable);

  const mockClient = {
    api: vi.fn(() => chainable),
  };

  const MockClient = {
    init: vi.fn(() => mockClient),
  };

  return { mockGraphApi, MockClient };
});

vi.mock('@microsoft/microsoft-graph-client', () => ({
  Client: MockClient,
}));

import { OutlookCalendarProvider } from '../../../../src/services/calendar-sync/providers/outlook.js';

// Helper to get typed fetch mock
function getFetchMock(): Mock {
  return global.fetch as Mock;
}

describe('OutlookCalendarProvider', () => {
  let provider: OutlookCalendarProvider;
  const mockConfig = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'http://localhost:3000/callback',
    scopes: ['Calendars.ReadWrite', 'User.Read'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OutlookCalendarProvider(mockConfig);
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAuthUrl', () => {
    it('should generate correct Microsoft OAuth URL', () => {
      const url = provider.getAuthUrl('test-state');

      expect(url).toContain('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
      expect(url).toContain(`client_id=${mockConfig.clientId}`);
      expect(url).toContain('response_type=code');
      expect(url).toContain('state=test-state');
    });
  });

  describe('exchangeCode', () => {
    it('should exchange authorization code for tokens', async () => {
      const mockTokenResponse = {
        access_token: 'outlook-access-token',
        refresh_token: 'outlook-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
      };

      getFetchMock().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });

      const tokens = await provider.exchangeCode('auth-code');

      expect(tokens.accessToken).toBe('outlook-access-token');
      expect(tokens.refreshToken).toBe('outlook-refresh-token');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('should throw error on failed exchange', async () => {
      getFetchMock().mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('Invalid code'),
      });

      await expect(provider.exchangeCode('invalid-code')).rejects.toThrow();
    });
  });

  describe('refreshToken', () => {
    it('should refresh access token', async () => {
      const mockTokenResponse = {
        access_token: 'refreshed-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
      };

      getFetchMock().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });

      const tokens = await provider.refreshToken('existing-refresh-token');

      expect(tokens.accessToken).toBe('refreshed-access-token');
    });
  });

  describe('listCalendars', () => {
    it('should return formatted calendar list from Graph API', async () => {
      const mockCalendars = {
        value: [
          {
            id: 'calendar-1',
            name: 'Calendar',
            isDefaultCalendar: true,
            color: 'auto',
            canEdit: true,
          },
          {
            id: 'calendar-2',
            name: 'Work Calendar',
            isDefaultCalendar: false,
            color: 'lightBlue',
            canEdit: true,
          },
        ],
      };

      mockGraphApi.get.mockResolvedValueOnce(mockCalendars);

      const calendars = await provider.listCalendars('test-token');

      expect(calendars).toHaveLength(2);
      expect(calendars[0]).toMatchObject({
        externalId: 'calendar-1',
        name: 'Calendar',
        isPrimary: true,
      });
    });
  });

  describe('getEvents', () => {
    it('should fetch events from Graph API', async () => {
      const mockEvents = {
        value: [
          {
            id: 'event-1',
            subject: 'Test Meeting',
            bodyPreview: 'Meeting notes',
            start: { dateTime: '2024-01-15T10:00:00', timeZone: 'UTC' },
            end: { dateTime: '2024-01-15T11:00:00', timeZone: 'UTC' },
            isAllDay: false,
            location: { displayName: 'Conference Room' },
            showAs: 'busy',
            sensitivity: 'normal',
            iCalUId: 'ical-uid-123',
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=abc',
      };

      mockGraphApi.get.mockResolvedValueOnce(mockEvents);

      const result = await provider.getEvents('test-token', 'calendar-1');

      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        externalId: 'event-1',
        title: 'Test Meeting',
      });
    });

    it('should use delta token for incremental sync', async () => {
      mockGraphApi.get.mockResolvedValueOnce({ value: [] });

      await provider.getEvents('test-token', 'calendar-1', {
        syncToken: 'delta-token',
      });

      expect(mockGraphApi.get).toHaveBeenCalled();
    });
  });

  describe('createEvent', () => {
    it('should create event via Graph API', async () => {
      const mockResponse = {
        id: 'created-event-id',
        subject: 'New Meeting',
        start: { dateTime: '2024-01-15T10:00:00', timeZone: 'UTC' },
        end: { dateTime: '2024-01-15T11:00:00', timeZone: 'UTC' },
        iCalUId: 'new-ical-uid',
      };

      mockGraphApi.post.mockResolvedValueOnce(mockResponse);

      const result = await provider.createEvent('test-token', 'calendar-1', {
        title: 'New Meeting',
        startTime: new Date('2024-01-15T10:00:00Z'),
        endTime: new Date('2024-01-15T11:00:00Z'),
        isAllDay: false,
        status: 'confirmed',
        visibility: 'public',
      });

      expect(result.externalId).toBe('created-event-id');
    });
  });

  describe('updateEvent', () => {
    it('should update event via Graph API PATCH', async () => {
      const mockResponse = {
        id: 'event-id',
        subject: 'Updated Meeting',
        start: { dateTime: '2024-01-15T10:00:00', timeZone: 'UTC' },
        end: { dateTime: '2024-01-15T11:00:00', timeZone: 'UTC' },
        iCalUId: 'ical-uid',
      };

      mockGraphApi.patch.mockResolvedValueOnce(mockResponse);

      const result = await provider.updateEvent('test-token', 'calendar-1', 'event-id', {
        title: 'Updated Meeting',
        startTime: new Date('2024-01-15T10:00:00Z'),
        endTime: new Date('2024-01-15T11:00:00Z'),
        isAllDay: false,
      });

      expect(result.externalId).toBe('event-id');
      expect(mockGraphApi.patch).toHaveBeenCalled();
    });
  });

  describe('deleteEvent', () => {
    it('should delete event via Graph API', async () => {
      mockGraphApi.delete.mockResolvedValueOnce(undefined);

      await provider.deleteEvent('test-token', 'calendar-1', 'event-id');

      expect(mockGraphApi.delete).toHaveBeenCalled();
    });
  });

  describe('getUserEmail', () => {
    it('should return user email from Graph profile', async () => {
      mockGraphApi.get.mockResolvedValueOnce({ mail: 'user@outlook.com' });

      const email = await provider.getUserEmail('test-token');

      expect(email).toBe('user@outlook.com');
    });

    it('should fall back to userPrincipalName', async () => {
      mockGraphApi.get.mockResolvedValueOnce({ userPrincipalName: 'user@company.onmicrosoft.com' });

      const email = await provider.getUserEmail('test-token');

      expect(email).toBe('user@company.onmicrosoft.com');
    });
  });
});
