/**
 * CalDAV Provider Unit Tests
 *
 * Generic CalDAV provider for third-party CalDAV servers (Fastmail, etc.)
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CalDAVProvider } from '../../../../src/services/calendar-sync/providers/caldav.js';

// Helper to create a valid CalDAV access token
function createCalDAVToken(serverUrl: string, username = 'user', password = 'pass'): string {
  const auth = Buffer.from(`${username}:${password}`).toString('base64');
  return Buffer.from(JSON.stringify({ serverUrl, auth })).toString('base64');
}

// Helper to create mock PROPFIND responses for CalDAV protocol
function mockCalDAVProtocolFlow() {
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

  return { principalResponse, homeResponse };
}

describe('CalDAVProvider', () => {
  let provider: CalDAVProvider;
  const testServerUrl = 'https://caldav.example.com/';
  const testToken = createCalDAVToken(testServerUrl);

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new CalDAVProvider();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('provider identity', () => {
    it('should identify as caldav provider', () => {
      expect(provider.provider).toBe('caldav');
    });
  });

  describe('getAuthUrl', () => {
    it('should return a special URL for credential entry', () => {
      const url = provider.getAuthUrl('test-state');
      expect(url).toContain('athena://caldav-auth');
      expect(url).toContain('state=test-state');
    });
  });

  describe('exchangeCode', () => {
    it('should throw on invalid credentials format', async () => {
      await expect(provider.exchangeCode('invalid-code')).rejects.toThrow('Invalid credentials format');
    });

    it('should validate and return tokens for valid credentials', async () => {
      const credentials = {
        serverUrl: 'https://caldav.example.com/',
        username: 'user',
        password: 'pass',
      };
      const code = Buffer.from(JSON.stringify(credentials)).toString('base64');

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<d:multistatus></d:multistatus>'),
      });

      const tokens = await provider.exchangeCode(code);
      expect(tokens.accessToken).toBeDefined();
    });
  });

  describe('refreshToken', () => {
    it('should validate and return same token (CalDAV uses static Basic Auth)', async () => {
      // refreshToken validates credentials still work
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<d:multistatus></d:multistatus>'),
      });

      const tokens = await provider.refreshToken(testToken);
      expect(tokens.accessToken).toBe(testToken);
    });
  });

  describe('listCalendars', () => {
    it('should fetch calendars via PROPFIND', async () => {
      const { principalResponse, homeResponse } = mockCalDAVProtocolFlow();
      const calendarsResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <d:response>
            <d:href>/calendars/user/calendar/</d:href>
            <d:propstat>
              <d:prop>
                <d:displayname>My Calendar</d:displayname>
                <d:resourcetype><c:calendar/></d:resourcetype>
                <calendar-color xmlns="http://apple.com/ns/ical/">#0000FF</calendar-color>
              </d:prop>
              <d:status>HTTP/1.1 200 OK</d:status>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(principalResponse) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(homeResponse) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(calendarsResponse) });

      const calendars = await provider.listCalendars(testToken);

      expect(calendars).toHaveLength(1);
      expect(calendars[0]).toMatchObject({
        name: 'My Calendar',
      });
    });
  });

  describe('getEvents', () => {
    it('should fetch events via REPORT calendar-query', async () => {
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
      const eventsResponse = `<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <d:response>
            <d:href>/cal/event.ics</d:href>
            <d:propstat>
              <d:prop>
                <d:getetag>"etag123"</d:getetag>
                <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-1@example.com
DTSTART:20240115T100000Z
DTEND:20240115T110000Z
SUMMARY:Test Event
END:VEVENT
END:VCALENDAR</c:calendar-data>
              </d:prop>
              <d:status>HTTP/1.1 200 OK</d:status>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(ctagResponse) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(eventsResponse) });

      const result = await provider.getEvents(testToken, 'https://caldav.example.com/calendars/user/calendar/');

      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        title: 'Test Event',
      });
    });
  });

  describe('createEvent', () => {
    it('should create event via PUT with generated UID', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ ETag: '"created-etag"' }),
      });

      const result = await provider.createEvent(testToken, 'calendar', {
        title: 'New Event',
        startTime: new Date('2024-01-15T10:00:00Z'),
        endTime: new Date('2024-01-15T11:00:00Z'),
        isAllDay: false,
        status: 'confirmed',
        visibility: 'public',
      });

      expect(result.externalId).toBeDefined();
      expect(result.etag).toBe('"created-etag"');
    });
  });

  describe('updateEvent', () => {
    it('should fetch existing event then PUT updated version', async () => {
      // Mock GET existing event
      const existingEvent = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-1@example.com
DTSTART:20240115T100000Z
DTEND:20240115T110000Z
SUMMARY:Old Title
END:VEVENT
END:VCALENDAR`;

      // Mock PUT updated event
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(existingEvent),
          headers: new Headers({ ETag: '"old-etag"' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ ETag: '"new-etag"' }),
        });

      const result = await provider.updateEvent(testToken, 'calendar', 'event-1.ics', {
        title: 'Updated Title',
        startTime: new Date('2024-01-15T10:00:00Z'),
        endTime: new Date('2024-01-15T11:00:00Z'),
        isAllDay: false,
      });

      expect(result.etag).toBe('"new-etag"');
    });
  });

  describe('deleteEvent', () => {
    it('should delete event via DELETE request', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await expect(provider.deleteEvent(testToken, 'calendar', 'event.ics')).resolves.not.toThrow();
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should handle 404 gracefully (event already deleted)', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(provider.deleteEvent(testToken, 'calendar', 'event.ics')).resolves.not.toThrow();
    });
  });
});
