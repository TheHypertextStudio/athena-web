/**
 * iCloud Calendar Provider Unit Tests
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ICloudCalendarProvider } from '../../../../src/services/calendar-sync/providers/icloud.js';

describe('ICloudCalendarProvider', () => {
  let provider: ICloudCalendarProvider;

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
    it('should throw since iCloud uses Basic Auth not OAuth', () => {
      expect(() => provider.getAuthUrl('state')).toThrow();
    });
  });

  describe('exchangeCode', () => {
    it('should throw since iCloud uses Basic Auth not OAuth', async () => {
      await expect(provider.exchangeCode('code')).rejects.toThrow();
    });
  });

  describe('refreshToken', () => {
    it('should throw since iCloud uses Basic Auth not OAuth', async () => {
      await expect(provider.refreshToken('token')).rejects.toThrow();
    });
  });

  describe('listCalendars', () => {
    it('should fetch calendars via CalDAV PROPFIND', async () => {
      const mockPropfindResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <multistatus xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">
          <response>
            <href>/calendars/user/calendar-1/</href>
            <propstat>
              <prop>
                <displayname>Personal</displayname>
                <a:calendar-color>#FF0000</a:calendar-color>
                <resourcetype><c:calendar/></resourcetype>
              </prop>
              <status>HTTP/1.1 200 OK</status>
            </propstat>
          </response>
        </multistatus>`;

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockPropfindResponse),
      });

      const calendars = await provider.listCalendars('username:password');

      expect(calendars).toHaveLength(1);
      expect(calendars[0]).toMatchObject({
        name: 'Personal',
      });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'PROPFIND',
        }),
      );
    });
  });

  describe('getEvents', () => {
    it('should fetch events via CalDAV REPORT', async () => {
      const mockReportResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <multistatus xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <response>
            <href>/calendars/user/calendar-1/event-1.ics</href>
            <propstat>
              <prop>
                <getetag>"etag-123"</getetag>
                <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-1
SUMMARY:Test Event
DTSTART:20240115T100000Z
DTEND:20240115T110000Z
END:VEVENT
END:VCALENDAR</c:calendar-data>
              </prop>
              <status>HTTP/1.1 200 OK</status>
            </propstat>
          </response>
        </multistatus>`;

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockReportResponse),
      });

      const result = await provider.getEvents('username:password', 'calendar-1');

      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        externalId: 'event-1',
        title: 'Test Event',
      });
    });

    it('should use CTag for change detection', async () => {
      // First call to get CTag
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(`<?xml version="1.0"?>
          <multistatus xmlns="DAV:">
            <response>
              <propstat>
                <prop><cs:getctag xmlns:cs="http://calendarserver.org/ns/">ctag-123</cs:getctag></prop>
              </propstat>
            </response>
          </multistatus>`),
      });

      // Second call to get events
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(`<?xml version="1.0"?><multistatus xmlns="DAV:"></multistatus>`),
      });

      const result = await provider.getEvents('username:password', 'calendar-1');

      expect(result.nextSyncToken).toBeDefined();
    });
  });

  describe('createEvent', () => {
    it('should create event via CalDAV PUT', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ ETag: '"new-etag"' }),
      });

      const result = await provider.createEvent('username:password', 'calendar-1', {
        title: 'New Event',
        startTime: new Date('2024-01-15T10:00:00Z'),
        endTime: new Date('2024-01-15T11:00:00Z'),
        isAllDay: false,
        status: 'confirmed',
        visibility: 'public',
      });

      expect(result.externalId).toBeDefined();
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('.ics'),
        expect.objectContaining({
          method: 'PUT',
        }),
      );
    });
  });

  describe('updateEvent', () => {
    it('should update event via CalDAV PUT', async () => {
      // First fetch existing event
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-1
SUMMARY:Original Title
DTSTART:20240115T100000Z
DTEND:20240115T110000Z
END:VEVENT
END:VCALENDAR`),
      });

      // Then update
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ ETag: '"updated-etag"' }),
      });

      const result = await provider.updateEvent('username:password', 'calendar-1', 'event-1', {
        title: 'Updated Title',
      });

      expect(result.externalId).toBe('event-1');
    });
  });

  describe('deleteEvent', () => {
    it('should delete event via CalDAV DELETE', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await provider.deleteEvent('username:password', 'calendar-1', 'event-1');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('event-1'),
        expect.objectContaining({
          method: 'DELETE',
        }),
      );
    });
  });
});
