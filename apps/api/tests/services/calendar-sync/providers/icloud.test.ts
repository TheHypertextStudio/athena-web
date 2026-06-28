/**
 * iCloud Calendar Provider Unit Tests
 *
 * iCloud uses CalDAV protocol with Basic Auth (Apple ID + app-specific password).
 *
 * @packageDocumentation
 */

import type { Mock } from 'vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ICloudCalendarProvider } from '../../../../src/services/calendar-sync/providers/icloud.js';

// Helper to create a valid iCloud access token (Base64-encoded "username:password")
function createICloudToken(username = 'user@icloud.com', password = 'app-specific-password'): string {
  return Buffer.from(`${username}:${password}`).toString('base64');
}

// Helper to get typed fetch mock
function getFetchMock(): Mock {
  return global.fetch as Mock;
}

// Helper to create mock CalDAV protocol flow responses
function mockCalDAVProtocolFlow(baseUrl = 'https://caldav.icloud.com') {
  const principalResponse = `<?xml version="1.0" encoding="UTF-8"?>
    <d:multistatus xmlns:d="DAV:">
      <d:response>
        <d:propstat>
          <d:prop>
            <d:current-user-principal>
              <d:href>/principals/user/</d:href>
            </d:current-user-principal>
          </d:prop>
          <d:status>HTTP/1.1 200 OK</d:status>
        </d:propstat>
      </d:response>
    </d:multistatus>`;

  const homeResponse = `<?xml version="1.0" encoding="UTF-8"?>
    <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
      <d:response>
        <d:propstat>
          <d:prop>
            <c:calendar-home-set>
              <d:href>/calendars/user/</d:href>
            </c:calendar-home-set>
          </d:prop>
          <d:status>HTTP/1.1 200 OK</d:status>
        </d:propstat>
      </d:response>
    </d:multistatus>`;

  return { principalResponse, homeResponse, baseUrl };
}

describe('ICloudCalendarProvider', () => {
  let provider: ICloudCalendarProvider;
  const testToken = createICloudToken();

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new ICloudCalendarProvider();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('provider identity', () => {
    it('should identify as icloud provider', () => {
      expect(provider.provider).toBe('icloud');
    });
  });

  describe('getAuthUrl', () => {
    it('should return a special URL for credential entry form', () => {
      const url = provider.getAuthUrl('test-state');
      expect(url).toContain('athena://icloud-auth');
      expect(url).toContain('state=test-state');
    });
  });

  describe('exchangeCode', () => {
    it('should throw on invalid credentials format (not proper base64)', async () => {
      // Pass something that decodes but isn't valid username:password format
      const noColonCredentials = Buffer.from('invalid-no-colon').toString('base64');
      await expect(provider.exchangeCode(noColonCredentials)).rejects.toThrow(
        'Credentials must be in format',
      );
    });

    it('should throw on malformed credentials (missing password)', async () => {
      const malformed = Buffer.from('just-username').toString('base64');
      await expect(provider.exchangeCode(malformed)).rejects.toThrow(
        'Credentials must be in format',
      );
    });

    it('should validate and return tokens for valid credentials', async () => {
      const credentials = `user@icloud.com:app-specific-password`;
      const code = Buffer.from(credentials).toString('base64');

      getFetchMock().mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<d:multistatus></d:multistatus>'),
      });

      const tokens = await provider.exchangeCode(code);

      expect(tokens.accessToken).toBe(code);
      expect(tokens.tokenType).toBe('Basic');
    });

    it('should throw on invalid Apple ID or password', async () => {
      const code = Buffer.from('user@icloud.com:wrong-password').toString('base64');

      getFetchMock().mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      await expect(provider.exchangeCode(code)).rejects.toThrow(
        'Invalid Apple ID or app-specific password',
      );
    });
  });

  describe('refreshToken', () => {
    it('should validate and return same token (iCloud uses static Basic Auth)', async () => {
      getFetchMock().mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<d:multistatus></d:multistatus>'),
      });

      const tokens = await provider.refreshToken(testToken);

      expect(tokens.accessToken).toBe(testToken);
      expect(tokens.refreshToken).toBe(testToken);
      expect(tokens.tokenType).toBe('Basic');
    });

    it('should throw if credentials are revoked', async () => {
      getFetchMock().mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      await expect(provider.refreshToken(testToken)).rejects.toThrow(
        'Credentials no longer valid',
      );
    });
  });

  describe('listCalendars', () => {
    it('should fetch calendars via CalDAV PROPFIND protocol flow', async () => {
      const { principalResponse, homeResponse } = mockCalDAVProtocolFlow();
      const calendarsResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">
          <d:response>
            <d:href>/calendars/user/calendar-1/</d:href>
            <d:propstat>
              <d:prop>
                <d:displayname>Personal</d:displayname>
                <d:resourcetype><c:calendar/></d:resourcetype>
                <a:calendar-color>#FF0000</a:calendar-color>
              </d:prop>
              <d:status>HTTP/1.1 200 OK</d:status>
            </d:propstat>
          </d:response>
          <d:response>
            <d:href>/calendars/user/work/</d:href>
            <d:propstat>
              <d:prop>
                <d:displayname>Work</d:displayname>
                <d:resourcetype><c:calendar/></d:resourcetype>
                <a:calendar-color>#0000FF</a:calendar-color>
              </d:prop>
              <d:status>HTTP/1.1 200 OK</d:status>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      getFetchMock()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(principalResponse) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(homeResponse) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(calendarsResponse) });

      const calendars = await provider.listCalendars(testToken);

      expect(calendars).toHaveLength(2);
      expect(calendars[0]).toMatchObject({
        name: 'Personal',
        color: '#FF0000',
      });
      expect(calendars[1]).toMatchObject({
        name: 'Work',
        color: '#0000FF',
      });
    });
  });

  describe('getEvents', () => {
    it('should fetch events via CalDAV REPORT calendar-query', async () => {
      // First call: fetchCtag (PROPFIND for getctag)
      const ctagResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <d:multistatus xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">
          <d:response>
            <d:propstat>
              <d:prop>
                <cs:getctag>ctag-123</cs:getctag>
              </d:prop>
              <d:status>HTTP/1.1 200 OK</d:status>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      // Second call: calendar-query (REPORT for events)
      const eventsResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <d:response>
            <d:href>/calendars/user/calendar-1/event-1.ics</d:href>
            <d:propstat>
              <d:prop>
                <d:getetag>"etag-123"</d:getetag>
                <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-1
SUMMARY:Test Event
DTSTART:20240115T100000Z
DTEND:20240115T110000Z
END:VEVENT
END:VCALENDAR</c:calendar-data>
              </d:prop>
              <d:status>HTTP/1.1 200 OK</d:status>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      getFetchMock()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(ctagResponse) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(eventsResponse) });

      const result = await provider.getEvents(testToken, 'https://caldav.icloud.com/calendars/user/calendar-1/');

      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        externalId: 'event-1',
        title: 'Test Event',
        etag: 'etag-123',
      });
      expect(result.nextSyncToken).toBe('ctag-123');
    });

    it('should return empty events if CTag matches (no changes)', async () => {
      const ctagResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <d:multistatus xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">
          <d:response>
            <d:propstat>
              <d:prop>
                <cs:getctag>same-ctag</cs:getctag>
              </d:prop>
              <d:status>HTTP/1.1 200 OK</d:status>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      getFetchMock().mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(ctagResponse),
      });

      const result = await provider.getEvents(testToken, 'calendar-1', {
        syncToken: 'same-ctag',
      });

      expect(result.events).toHaveLength(0);
      expect(result.fullSync).toBe(false);
      expect(result.nextSyncToken).toBe('same-ctag');
    });

    it('should handle all-day events', async () => {
      const ctagResponse = `<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">
          <d:response><d:propstat><d:prop><cs:getctag>ctag</cs:getctag></d:prop></d:propstat></d:response>
        </d:multistatus>`;

      const eventsResponse = `<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <d:response>
            <d:href>/cal/all-day.ics</d:href>
            <d:propstat>
              <d:prop>
                <d:getetag>"etag"</d:getetag>
                <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:all-day-event
SUMMARY:All Day Event
DTSTART;VALUE=DATE:20240115
DTEND;VALUE=DATE:20240116
END:VEVENT
END:VCALENDAR</c:calendar-data>
              </d:prop>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      getFetchMock()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(ctagResponse) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(eventsResponse) });

      const result = await provider.getEvents(testToken, 'calendar-1');

      expect(result.events[0]?.isAllDay).toBe(true);
    });
  });

  describe('createEvent', () => {
    it('should create event via CalDAV PUT', async () => {
      getFetchMock().mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ ETag: '"new-etag"' }),
      });

      const result = await provider.createEvent(testToken, 'https://caldav.icloud.com/calendars/user/calendar-1/', {
        title: 'New Event',
        startTime: new Date('2024-01-15T10:00:00Z'),
        endTime: new Date('2024-01-15T11:00:00Z'),
        isAllDay: false,
        status: 'confirmed',
        visibility: 'public',
      });

      expect(result.externalId).toBeDefined();
      expect(result.etag).toBe('"new-etag"');
      expect(getFetchMock()).toHaveBeenCalledWith(
        expect.stringContaining('.ics') as unknown,
        expect.objectContaining({
          method: 'PUT',
        }) as unknown,
      );
    });
  });

  describe('updateEvent', () => {
    it('should fetch existing event then PUT updated version', async () => {
      // Mock GET existing event
      const existingEvent = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-1
SUMMARY:Original Title
DTSTART:20240115T100000Z
DTEND:20240115T110000Z
END:VEVENT
END:VCALENDAR`;

      // Mock PUT updated event
      getFetchMock()
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(existingEvent),
          headers: new Headers({ ETag: '"old-etag"' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ ETag: '"updated-etag"' }),
        });

      const result = await provider.updateEvent(testToken, 'https://caldav.icloud.com/calendars/user/calendar-1/', 'event-1', {
        title: 'Updated Title',
      });

      expect(result.externalId).toBe('event-1');
      expect(result.etag).toBe('"updated-etag"');
    });
  });

  describe('deleteEvent', () => {
    it('should delete event via CalDAV DELETE', async () => {
      getFetchMock().mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await expect(
        provider.deleteEvent(testToken, 'https://caldav.icloud.com/calendars/user/calendar-1/', 'event-1'),
      ).resolves.not.toThrow();
      expect(getFetchMock()).toHaveBeenCalledWith(
        expect.stringContaining('event-1') as unknown,
        expect.objectContaining({
          method: 'DELETE',
        }) as unknown,
      );
    });

    it('should handle 404 gracefully (event already deleted)', async () => {
      getFetchMock().mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(
        provider.deleteEvent(testToken, 'calendar-1', 'event-1'),
      ).resolves.not.toThrow();
    });
  });
});
