/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
/**
 * CalDAV Provider Unit Tests
 *
 * Generic CalDAV provider for third-party CalDAV servers (Fastmail, etc.)
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CalDAVProvider } from '../../../../src/services/calendar-sync/providers/caldav.js';

describe('CalDAVProvider', () => {
  let provider: CalDAVProvider;

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
    it('should throw since CalDAV uses Basic Auth not OAuth', () => {
      expect(() => provider.getAuthUrl('state')).toThrow();
    });
  });

  describe('exchangeCode', () => {
    it('should throw since CalDAV uses Basic Auth not OAuth', async () => {
      await expect(provider.exchangeCode('code')).rejects.toThrow();
    });
  });

  describe('refreshToken', () => {
    it('should throw since CalDAV uses Basic Auth not OAuth', async () => {
      await expect(provider.refreshToken('token')).rejects.toThrow();
    });
  });

  describe('listCalendars', () => {
    it('should fetch calendars via PROPFIND', async () => {
      const mockResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <d:response>
            <d:href>/caldav/user/calendar/</d:href>
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

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockResponse),
      });

      const calendars = await provider.listCalendars('user:pass@https://caldav.example.com/');

      expect(calendars).toHaveLength(1);
      expect(calendars[0]).toMatchObject({
        name: 'My Calendar',
      });
    });

    it('should handle multiple calendars', async () => {
      const mockResponse = `<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <d:response>
            <d:href>/cal/personal/</d:href>
            <d:propstat>
              <d:prop>
                <d:displayname>Personal</d:displayname>
                <d:resourcetype><c:calendar/></d:resourcetype>
              </d:prop>
              <d:status>HTTP/1.1 200 OK</d:status>
            </d:propstat>
          </d:response>
          <d:response>
            <d:href>/cal/work/</d:href>
            <d:propstat>
              <d:prop>
                <d:displayname>Work</d:displayname>
                <d:resourcetype><c:calendar/></d:resourcetype>
              </d:prop>
              <d:status>HTTP/1.1 200 OK</d:status>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockResponse),
      });

      const calendars = await provider.listCalendars('user:pass@https://caldav.example.com/');

      expect(calendars).toHaveLength(2);
    });
  });

  describe('getEvents', () => {
    it('should fetch events via REPORT calendar-query', async () => {
      const mockResponse = `<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <d:response>
            <d:href>/cal/personal/event-abc.ics</d:href>
            <d:propstat>
              <d:prop>
                <d:getetag>"etag-abc"</d:getetag>
                <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:event-abc
SUMMARY:Team Meeting
DTSTART:20240115T140000Z
DTEND:20240115T150000Z
LOCATION:Room 101
END:VEVENT
END:VCALENDAR</c:calendar-data>
              </d:prop>
              <d:status>HTTP/1.1 200 OK</d:status>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockResponse),
      });

      const result = await provider.getEvents('user:pass@https://caldav.example.com/', 'personal');

      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toMatchObject({
        externalId: 'event-abc',
        title: 'Team Meeting',
        location: 'Room 101',
      });
    });

    it('should handle time range filtering', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>`),
      });

      await provider.getEvents('user:pass@https://caldav.example.com/', 'calendar-1', {
        timeMin: new Date('2024-01-01'),
        timeMax: new Date('2024-01-31'),
      });

      // Verify REPORT request includes time-range filter
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'REPORT',
          body: expect.stringContaining('time-range'),
        }),
      );
    });

    it('should handle all-day events', async () => {
      const mockResponse = `<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <d:response>
            <d:href>/cal/event.ics</d:href>
            <d:propstat>
              <d:prop>
                <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:all-day-event
SUMMARY:Holiday
DTSTART;VALUE=DATE:20240115
DTEND;VALUE=DATE:20240116
END:VEVENT
END:VCALENDAR</c:calendar-data>
              </d:prop>
              <d:status>HTTP/1.1 200 OK</d:status>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockResponse),
      });

      const result = await provider.getEvents('user:pass@https://caldav.example.com/', 'cal');

      expect(result.events[0].isAllDay).toBe(true);
    });

    it('should parse recurring events', async () => {
      const mockResponse = `<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <d:response>
            <d:href>/cal/event.ics</d:href>
            <d:propstat>
              <d:prop>
                <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:recurring-event
SUMMARY:Weekly Standup
DTSTART:20240115T090000Z
DTEND:20240115T093000Z
RRULE:FREQ=WEEKLY;BYDAY=MO
END:VEVENT
END:VCALENDAR</c:calendar-data>
              </d:prop>
              <d:status>HTTP/1.1 200 OK</d:status>
            </d:propstat>
          </d:response>
        </d:multistatus>`;

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockResponse),
      });

      const result = await provider.getEvents('user:pass@https://caldav.example.com/', 'cal');

      expect(result.events[0].recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO');
    });
  });

  describe('createEvent', () => {
    it('should create event via PUT with generated UID', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ ETag: '"created-etag"' }),
      });

      const result = await provider.createEvent(
        'user:pass@https://caldav.example.com/',
        'calendar-1',
        {
          title: 'New Event',
          description: 'Event description',
          startTime: new Date('2024-01-15T10:00:00Z'),
          endTime: new Date('2024-01-15T11:00:00Z'),
          isAllDay: false,
          location: 'Office',
          status: 'confirmed',
          visibility: 'public',
        },
      );

      expect(result.externalId).toBeDefined();
      expect(result.etag).toBe('"created-etag"');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('.ics'),
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'Content-Type': 'text/calendar; charset=utf-8',
          }),
        }),
      );
    });

    it('should include RRULE for recurring events', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ ETag: '"etag"' }),
      });

      await provider.createEvent('user:pass@https://caldav.example.com/', 'calendar-1', {
        title: 'Recurring',
        startTime: new Date('2024-01-15T10:00:00Z'),
        isAllDay: false,
        recurrenceRule: 'FREQ=DAILY;COUNT=5',
        status: 'confirmed',
        visibility: 'public',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('RRULE:FREQ=DAILY;COUNT=5'),
        }),
      );
    });
  });

  describe('updateEvent', () => {
    it('should fetch existing event then PUT updated version', async () => {
      // GET existing event
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:existing-event
SUMMARY:Original Title
DTSTART:20240115T100000Z
DTEND:20240115T110000Z
END:VEVENT
END:VCALENDAR`),
        headers: new Headers({ ETag: '"old-etag"' }),
      });

      // PUT updated event
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ ETag: '"new-etag"' }),
      });

      const result = await provider.updateEvent(
        'user:pass@https://caldav.example.com/',
        'calendar-1',
        'existing-event',
        { title: 'Updated Title' },
      );

      expect(result.externalId).toBe('existing-event');
      expect(result.etag).toBe('"new-etag"');
    });

    it('should preserve existing properties when updating', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event
SUMMARY:Title
DTSTART:20240115T100000Z
DTEND:20240115T110000Z
LOCATION:Room A
DESCRIPTION:Important meeting
END:VEVENT
END:VCALENDAR`),
      });

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ ETag: '"etag"' }),
      });

      await provider.updateEvent('user:pass@https://caldav.example.com/', 'cal', 'event', {
        title: 'New Title',
        // Not updating location or description
      });

      // Should preserve LOCATION and DESCRIPTION
      const putCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
      const body = putCall?.[1]?.body as string;
      expect(body).toContain('LOCATION:Room A');
      expect(body).toContain('DESCRIPTION:Important meeting');
    });
  });

  describe('deleteEvent', () => {
    it('should delete event via DELETE request', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await provider.deleteEvent(
        'user:pass@https://caldav.example.com/',
        'calendar-1',
        'event-to-delete',
      );

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('event-to-delete'),
        expect.objectContaining({
          method: 'DELETE',
        }),
      );
    });

    it('should handle 404 gracefully (event already deleted)', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      // Should not throw for 404 - event is already gone
      await expect(
        provider.deleteEvent('user:pass@https://caldav.example.com/', 'cal', 'gone-event'),
      ).resolves.not.toThrow();
    });
  });
});
