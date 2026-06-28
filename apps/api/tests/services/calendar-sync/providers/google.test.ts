/**
 * Google Calendar Provider Unit Tests
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted mock setup - these must be created with vi.hoisted to be available in vi.mock factory
const { mockCalendarEvents, mockCalendarList, _mockChannels, mockUserInfo, MockCalendar, MockOauth2, MockOAuth2Client } = vi.hoisted(() => {
  const mockCalendarEvents = {
    list: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    watch: vi.fn(),
  };

  const mockCalendarList = {
    list: vi.fn(),
  };

  const mockChannels = {
    stop: vi.fn(),
  };

  const mockUserInfo = {
    get: vi.fn(),
  };

  // Create class mocks that return the mock objects
  class MockCalendar {
    events = mockCalendarEvents;
    calendarList = mockCalendarList;
    channels = mockChannels;
  }

  class MockOauth2 {
    userinfo = mockUserInfo;
  }

  class MockOAuth2Client {
    credentials = {};
    setCredentials = vi.fn();
    getAccessToken = vi.fn().mockResolvedValue({ token: 'test-token' });
  }

  return { mockCalendarEvents, mockCalendarList, _mockChannels: mockChannels, mockUserInfo, MockCalendar, MockOauth2, MockOAuth2Client };
});

vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => new MockCalendar()),
    auth: {
      OAuth2: MockOAuth2Client,
    },
  },
  calendar_v3: {
    Calendar: MockCalendar,
  },
  oauth2_v2: {
    Oauth2: MockOauth2,
  },
}));

import { GoogleCalendarProvider } from '../../../../src/services/calendar-sync/providers/google.js';

describe('GoogleCalendarProvider', () => {
  let provider: GoogleCalendarProvider;
  const mockConfig = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'http://localhost:3000/callback',
    scopes: ['https://www.googleapis.com/auth/calendar'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GoogleCalendarProvider(mockConfig);
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAuthUrl', () => {
    it('should generate correct OAuth URL with all parameters', () => {
      const url = provider.getAuthUrl('test-state');

      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url).toContain(`client_id=${mockConfig.clientId}`);
      expect(url).toContain('response_type=code');
      expect(url).toContain('access_type=offline');
      expect(url).toContain('state=test-state');
    });
  });

  describe('exchangeCode', () => {
    it('should exchange authorization code for tokens', async () => {
      const mockTokenResponse = {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'https://www.googleapis.com/auth/calendar',
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });

      const tokens = await provider.exchangeCode('auth-code');

      expect(tokens.accessToken).toBe('new-access-token');
      expect(tokens.refreshToken).toBe('new-refresh-token');
      expect(tokens.tokenType).toBe('Bearer');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/token',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('should throw error on failed exchange', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('Invalid code'),
      });

      await expect(provider.exchangeCode('invalid-code')).rejects.toThrow(
        'Failed to exchange code',
      );
    });
  });

  describe('refreshToken', () => {
    it('should refresh access token', async () => {
      const mockTokenResponse = {
        access_token: 'refreshed-access-token',
        expires_in: 3600,
        token_type: 'Bearer',
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });

      const tokens = await provider.refreshToken('existing-refresh-token');

      expect(tokens.accessToken).toBe('refreshed-access-token');
      expect(tokens.refreshToken).toBe('existing-refresh-token'); // Kept original
    });

    it('should throw error on failed refresh', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('Token expired'),
      });

      await expect(provider.refreshToken('expired-refresh')).rejects.toThrow(
        'Failed to refresh token',
      );
    });
  });

  describe('listCalendars', () => {
    it('should return formatted calendar list', async () => {
      mockCalendarList.list.mockResolvedValueOnce({
        data: {
          items: [
            {
              id: 'primary',
              summary: 'Primary Calendar',
              primary: true,
              backgroundColor: '#4285f4',
              accessRole: 'owner',
            },
            {
              id: 'work@group.calendar.google.com',
              summary: 'Work',
              primary: false,
              backgroundColor: '#33b679',
              accessRole: 'writer',
            },
          ],
        },
      });

      const calendars = await provider.listCalendars('test-token');

      expect(calendars).toHaveLength(2);
      expect(calendars[0]).toMatchObject({
        externalId: 'primary',
        name: 'Primary Calendar',
        isPrimary: true,
      });
      expect(calendars[1]).toMatchObject({
        externalId: 'work@group.calendar.google.com',
        name: 'Work',
        isPrimary: false,
      });
    });
  });

  describe('getEvents', () => {
    it('should fetch events with time range filter', async () => {
      const mockEvents = {
        data: {
          items: [
            {
              id: 'event-1',
              summary: 'Test Event',
              description: 'Test description',
              start: { dateTime: '2024-01-15T10:00:00Z' },
              end: { dateTime: '2024-01-15T11:00:00Z' },
              location: 'Test Location',
              status: 'confirmed',
              visibility: 'default',
              etag: '"etag-123"',
              iCalUID: 'uid-123@google.com',
            },
          ],
          nextSyncToken: 'sync-token-abc',
        },
      };

      mockCalendarEvents.list.mockResolvedValueOnce(mockEvents);

      const result = await provider.getEvents('test-token', 'primary', {
        timeMin: new Date('2024-01-01'),
        timeMax: new Date('2024-01-31'),
      });

      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        externalId: 'event-1',
        title: 'Test Event',
        description: 'Test description',
        location: 'Test Location',
      });
      expect(result.nextSyncToken).toBe('sync-token-abc');
    });

    it('should handle all-day events', async () => {
      mockCalendarEvents.list.mockResolvedValueOnce({
        data: {
          items: [
            {
              id: 'all-day-event',
              summary: 'All Day Event',
              start: { date: '2024-01-15' },
              end: { date: '2024-01-16' },
              status: 'confirmed',
            },
          ],
        },
      });

      const result = await provider.getEvents('test-token', 'primary');

      expect(result.events[0].isAllDay).toBe(true);
    });

    it('should return sync token from response', async () => {
      mockCalendarEvents.list.mockResolvedValueOnce({
        data: {
          items: [],
          nextSyncToken: 'new-sync-token',
        },
      });

      const result = await provider.getEvents('test-token', 'primary');

      expect(result.nextSyncToken).toBe('new-sync-token');
      // singleEvents: true is used, so syncToken isn't passed to the API
      expect(mockCalendarEvents.list).toHaveBeenCalledWith(
        expect.objectContaining({
          singleEvents: true,
        }) as unknown,
      );
    });
  });

  describe('createEvent', () => {
    it('should create event and return external ID', async () => {
      mockCalendarEvents.insert.mockResolvedValueOnce({
        data: {
          id: 'created-event-id',
          etag: '"new-etag"',
          iCalUID: 'new-uid@google.com',
        },
      });

      const result = await provider.createEvent('test-token', 'primary', {
        title: 'New Event',
        startTime: new Date('2024-01-15T10:00:00Z'),
        endTime: new Date('2024-01-15T11:00:00Z'),
        isAllDay: false,
        status: 'confirmed',
        visibility: 'public',
      });

      expect(result.externalId).toBe('created-event-id');
      expect(result.etag).toBe('"new-etag"');
    });
  });

  describe('updateEvent', () => {
    it('should update event and return updated data', async () => {
      mockCalendarEvents.patch.mockResolvedValueOnce({
        data: {
          id: 'event-id',
          summary: 'Updated Title',
          start: { dateTime: '2024-01-15T10:00:00Z' },
          end: { dateTime: '2024-01-15T11:00:00Z' },
          etag: '"updated-etag"',
        },
      });

      const result = await provider.updateEvent('test-token', 'primary', 'event-id', {
        title: 'Updated Title',
        startTime: new Date('2024-01-15T10:00:00Z'),
        endTime: new Date('2024-01-15T11:00:00Z'),
        isAllDay: false,
      });

      expect(result.externalId).toBe('event-id');
      expect(result.etag).toBe('"updated-etag"');
    });
  });

  describe('deleteEvent', () => {
    it('should delete event', async () => {
      mockCalendarEvents.delete.mockResolvedValueOnce({});

      await provider.deleteEvent('test-token', 'primary', 'event-id');

      expect(mockCalendarEvents.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarId: 'primary',
          eventId: 'event-id',
        }),
      );
    });
  });

  describe('getUserEmail', () => {
    it('should return user email from profile', async () => {
      mockUserInfo.get.mockResolvedValueOnce({
        data: { email: 'user@example.com' },
      });

      const email = await provider.getUserEmail('test-token');

      expect(email).toBe('user@example.com');
    });

    it('should return undefined on error', async () => {
      mockUserInfo.get.mockRejectedValueOnce(new Error('API error'));

      const email = await provider.getUserEmail('test-token');

      expect(email).toBeUndefined();
    });
  });
});
