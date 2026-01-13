/**
 * CalDAV/CardDAV routes integration tests.
 *
 * Tests for DAV protocol endpoints used by native calendar apps.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetMockDb, type MockDb } from '../test-utils.js';

// Use hoisted for both mock db and auth state so they're available during module init
const mockDb = vi.hoisted(() => {
  const factory = (globalThis as { __athenaMockDbFactory?: () => MockDb }).__athenaMockDbFactory;
  if (!factory) {
    throw new Error('Mock DB factory not initialized');
  }
  return factory();
});

// Hoisted auth state that can be controlled per test
const authState = vi.hoisted(() => ({
  shouldAuthenticate: true,
  mockAuthResult: {
    userId: 'test-user-id',
    email: 'test@example.com',
    scopes: ['caldav', 'carddav'] as string[],
    appPasswordId: 'app-pass-id',
  },
}));

vi.mock('../../../src/db/index.js', () => ({ db: mockDb }));

vi.mock('../../../src/lib/auth.js', () => ({
  auth: {
    api: { getSession: () => null },
    handler: () => new Response(),
  },
}));

// Mock the CalDAV auth module with hoisted state
vi.mock('../../../src/services/caldav-server/auth.js', () => ({
  authenticateDav: vi.fn(() => {
    if (!authState.shouldAuthenticate) return Promise.resolve(null);
    return Promise.resolve(authState.mockAuthResult);
  }),
  requireDavAuth: vi.fn((requiredScope: string) => {
    return async (
      c: { set: (key: string, value: unknown) => void; get: (key: string) => unknown },
      next: () => Promise<void>,
    ) => {
      if (!authState.shouldAuthenticate) {
        throw new (await import('hono/http-exception')).HTTPException(401, {
          message: 'Unauthorized',
          res: new Response('Unauthorized', {
            status: 401,
            headers: {
              'WWW-Authenticate': 'Basic realm="Athena"',
              DAV: '1, 2, 3, calendar-access',
            },
          }),
        });
      }
      if (!authState.mockAuthResult.scopes.includes(requiredScope)) {
        throw new (await import('hono/http-exception')).HTTPException(403, {
          message: 'Forbidden - insufficient scope',
        });
      }
      c.set('davAuth', authState.mockAuthResult);
      c.set('userId', authState.mockAuthResult.userId);
      await next();
    };
  }),
  getDavAuth: vi.fn((c: { get: (key: string) => unknown }) => {
    return c.get('davAuth') ?? authState.mockAuthResult;
  }),
  hashPassword: vi.fn(() => Promise.resolve('mock:hashed')),
  verifyPassword: vi.fn(() => Promise.resolve(true)),
  generateAppPassword: vi.fn(() => 'test-pass-1234'),
}));

import { app } from '../../../src/index.js';

const TEST_USER = {
  id: 'test-user-id',
  email: 'test@example.com',
  emailVerified: true,
  createdAt: new Date(),
};

const TEST_APP_PASSWORD = {
  id: 'app-pass-id',
  userId: 'test-user-id',
  name: 'Test Device',
  passwordHash: 'mock:test-password',
  scopes: ['caldav', 'carddav'],
  lastUsedAt: null,
  lastUsedIp: null,
  expiresAt: null,
  createdAt: new Date(),
};

const TEST_CALENDAR = {
  id: 'calendar-1',
  userId: 'test-user-id',
  name: 'Personal',
  description: 'Personal calendar',
  color: '#4285F4',
  timezone: 'America/New_York',
  ctag: 'ctag-123',
  syncToken: 1,
  isDefault: true,
  isReadOnly: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const TEST_EVENT = {
  id: 'event-1',
  creatorId: 'test-user-id',
  calendarId: 'calendar-1',
  title: 'Test Event',
  description: 'Test description',
  startTime: new Date('2026-01-15T10:00:00Z'),
  endTime: new Date('2026-01-15T11:00:00Z'),
  isAllDay: false,
  location: 'Room 101',
  recurrenceRule: null,
  calendarStatus: 'CONFIRMED',
  transparency: 'OPAQUE',
  classification: 'PUBLIC',
  etag: 'etag-abc123',
  sequence: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Create Basic Auth header value.
 */
function basicAuth(email: string, password: string): string {
  const credentials = Buffer.from(`${email}:${password}`).toString('base64');
  return `Basic ${credentials}`;
}

// Helper to set auth state for tests
function setAuthState(authenticated: boolean) {
  authState.shouldAuthenticate = authenticated;
}

describe('CalDAV Routes', () => {
  beforeEach(() => {
    resetMockDb(mockDb);
    authState.shouldAuthenticate = true; // Reset to authenticated by default
    mockDb.query.users.findFirst.mockResolvedValue(TEST_USER);
    mockDb.query.appPasswords.findMany.mockResolvedValue([TEST_APP_PASSWORD]);
    mockDb.query.calendars.findFirst.mockResolvedValue(TEST_CALENDAR);
    mockDb.query.calendars.findMany.mockResolvedValue([TEST_CALENDAR]);
    mockDb.query.events.findFirst.mockResolvedValue(TEST_EVENT);
    mockDb.query.events.findMany.mockResolvedValue([TEST_EVENT]);
  });

  describe('OPTIONS /dav/*', () => {
    it('should advertise DAV capabilities without auth', async () => {
      const res = await app.request('/dav/', {
        method: 'OPTIONS',
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('DAV')).toBe('1, 2, 3, calendar-access');
      expect(res.headers.get('Allow')).toContain('PROPFIND');
      expect(res.headers.get('Allow')).toContain('PUT');
      expect(res.headers.get('Allow')).toContain('DELETE');
    });

    it('should include CORS headers', async () => {
      const res = await app.request('/dav/calendars/test-user-id/', {
        method: 'OPTIONS',
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PROPFIND');
      expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    });
  });

  describe('PROPFIND /dav/', () => {
    it('should allow unauthenticated discovery of root', async () => {
      const res = await app.request('/dav/', {
        method: 'PROPFIND',
        headers: {
          Depth: '0',
        },
      });

      expect(res.status).toBe(207);
      expect(res.headers.get('Content-Type')).toContain('application/xml');

      const body = await res.text();
      expect(body).toContain('multistatus');
      expect(body).toContain('resourcetype');
    });

    it('should return current-user-principal when authenticated', async () => {
      const res = await app.request('/dav/', {
        method: 'PROPFIND',
        headers: {
          Depth: '0',
          Authorization: basicAuth('test@example.com', 'test-password'),
        },
      });

      expect(res.status).toBe(207);
      const body = await res.text();
      expect(body).toContain('current-user-principal');
      expect(body).toContain('/dav/principals/test-user-id/');
    });

    it('should indicate unauthenticated state for root without auth', async () => {
      mockDb.query.users.findFirst.mockResolvedValue(null);

      const res = await app.request('/dav/', {
        method: 'PROPFIND',
        headers: {
          Depth: '0',
        },
      });

      expect(res.status).toBe(207);
      const body = await res.text();
      expect(body).toContain('unauthenticated');
    });
  });

  describe('PROPFIND /dav/principals/{userId}/', () => {
    it('should return 401 when accessing specific principal without auth', async () => {
      setAuthState(false);

      const res = await app.request('/dav/principals/test-user-id/', {
        method: 'PROPFIND',
        headers: {
          Depth: '0',
        },
      });

      // Accessing a specific principal requires auth
      expect(res.status).toBe(401);
    });

    it('should return calendar-home-set when authenticated', async () => {
      const res = await app.request('/dav/principals/test-user-id/', {
        method: 'PROPFIND',
        headers: {
          Depth: '0',
          Authorization: basicAuth('test@example.com', 'test-password'),
        },
      });

      expect(res.status).toBe(207);
      const body = await res.text();
      expect(body).toContain('calendar-home-set');
      expect(body).toContain('/dav/calendars/test-user-id/');
    });

    it('should return 403 when accessing another user principal', async () => {
      const res = await app.request('/dav/principals/other-user-id/', {
        method: 'PROPFIND',
        headers: {
          Depth: '0',
          Authorization: basicAuth('test@example.com', 'test-password'),
        },
      });

      expect(res.status).toBe(403);
    });
  });

  describe('PROPFIND /dav/calendars/{userId}/', () => {
    it('should list user calendars when authenticated', async () => {
      const res = await app.request('/dav/calendars/test-user-id/', {
        method: 'PROPFIND',
        headers: {
          Depth: '1',
          Authorization: basicAuth('test@example.com', 'test-password'),
        },
      });

      expect(res.status).toBe(207);
      const body = await res.text();
      expect(body).toContain('Personal');
      expect(body).toContain('calendar-1');
    });

    it('should return 403 when accessing another user calendars', async () => {
      const res = await app.request('/dav/calendars/other-user-id/', {
        method: 'PROPFIND',
        headers: {
          Depth: '1',
          Authorization: basicAuth('test@example.com', 'test-password'),
        },
      });

      expect(res.status).toBe(403);
    });
  });

  describe('PROPFIND /dav/calendars/{userId}/{calendarId}/', () => {
    it('should return calendar properties', async () => {
      const res = await app.request('/dav/calendars/test-user-id/calendar-1/', {
        method: 'PROPFIND',
        headers: {
          Depth: '0',
          Authorization: basicAuth('test@example.com', 'test-password'),
        },
      });

      expect(res.status).toBe(207);
      const body = await res.text();
      expect(body).toContain('displayname');
      expect(body).toContain('getctag');
      expect(body).toContain('sync-token');
    });

    it('should list events with Depth 1', async () => {
      const res = await app.request('/dav/calendars/test-user-id/calendar-1/', {
        method: 'PROPFIND',
        headers: {
          Depth: '1',
          Authorization: basicAuth('test@example.com', 'test-password'),
        },
      });

      expect(res.status).toBe(207);
      const body = await res.text();
      expect(body).toContain('event-1.ics');
      expect(body).toContain('getetag');
    });

    it('should return 404 for non-existent calendar', async () => {
      mockDb.query.calendars.findFirst.mockResolvedValue(null);

      const res = await app.request('/dav/calendars/test-user-id/non-existent/', {
        method: 'PROPFIND',
        headers: {
          Depth: '0',
          Authorization: basicAuth('test@example.com', 'test-password'),
        },
      });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /dav/calendars/{userId}/{calendarId}/{eventId}.ics', () => {
    it('should return 401 without authentication', async () => {
      setAuthState(false);

      const res = await app.request('/dav/calendars/test-user-id/calendar-1/event-1.ics', {
        method: 'GET',
      });

      expect(res.status).toBe(401);
      expect(res.headers.get('WWW-Authenticate')).toContain('Basic');
    });

    it('should return event as iCalendar format', async () => {
      const res = await app.request('/dav/calendars/test-user-id/calendar-1/event-1.ics', {
        method: 'GET',
        headers: {
          Authorization: basicAuth('test@example.com', 'test-password'),
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/calendar');
      expect(res.headers.get('ETag')).toBe('"etag-abc123"');

      const body = await res.text();
      expect(body).toContain('BEGIN:VCALENDAR');
      expect(body).toContain('BEGIN:VEVENT');
      expect(body).toContain('SUMMARY:Test Event');
      expect(body).toContain('END:VEVENT');
      expect(body).toContain('END:VCALENDAR');
    });

    it('should return 404 for non-existent event', async () => {
      mockDb.query.events.findFirst.mockResolvedValue(null);

      const res = await app.request('/dav/calendars/test-user-id/calendar-1/non-existent.ics', {
        method: 'GET',
        headers: {
          Authorization: basicAuth('test@example.com', 'test-password'),
        },
      });

      expect(res.status).toBe(404);
    });

    it('should return 403 for other user calendar', async () => {
      const res = await app.request('/dav/calendars/other-user-id/calendar-1/event-1.ics', {
        method: 'GET',
        headers: {
          Authorization: basicAuth('test@example.com', 'test-password'),
        },
      });

      expect(res.status).toBe(403);
    });
  });

  describe('PUT /dav/calendars/{userId}/{calendarId}/{eventId}.ics', () => {
    const validICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:new-event-id
DTSTART:20260115T100000Z
DTEND:20260115T110000Z
SUMMARY:New Event
DESCRIPTION:New event description
END:VEVENT
END:VCALENDAR`;

    it('should return 401 without authentication', async () => {
      setAuthState(false);

      const res = await app.request('/dav/calendars/test-user-id/calendar-1/new-event.ics', {
        method: 'PUT',
        body: validICS,
      });

      expect(res.status).toBe(401);
    });

    it('should create new event and return 201', async () => {
      mockDb.query.events.findFirst.mockResolvedValue(null);

      const res = await app.request('/dav/calendars/test-user-id/calendar-1/new-event.ics', {
        method: 'PUT',
        headers: {
          Authorization: basicAuth('test@example.com', 'test-password'),
          'Content-Type': 'text/calendar',
        },
        body: validICS,
      });

      expect(res.status).toBe(201);
      expect(res.headers.get('ETag')).toBeTruthy();
      expect(res.headers.get('Location')).toContain('new-event.ics');
    });

    it('should update existing event and return 204', async () => {
      const res = await app.request('/dav/calendars/test-user-id/calendar-1/event-1.ics', {
        method: 'PUT',
        headers: {
          Authorization: basicAuth('test@example.com', 'test-password'),
          'Content-Type': 'text/calendar',
        },
        body: validICS,
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('ETag')).toBeTruthy();
    });

    it('should return 412 on If-Match mismatch (conflict detection)', async () => {
      const res = await app.request('/dav/calendars/test-user-id/calendar-1/event-1.ics', {
        method: 'PUT',
        headers: {
          Authorization: basicAuth('test@example.com', 'test-password'),
          'Content-Type': 'text/calendar',
          'If-Match': '"wrong-etag"',
        },
        body: validICS,
      });

      expect(res.status).toBe(412);
    });

    it('should return 412 on If-None-Match:* when event exists', async () => {
      const res = await app.request('/dav/calendars/test-user-id/calendar-1/event-1.ics', {
        method: 'PUT',
        headers: {
          Authorization: basicAuth('test@example.com', 'test-password'),
          'Content-Type': 'text/calendar',
          'If-None-Match': '*',
        },
        body: validICS,
      });

      expect(res.status).toBe(412);
    });

    it('should return 403 for read-only calendar', async () => {
      mockDb.query.calendars.findFirst.mockResolvedValue({
        ...TEST_CALENDAR,
        isReadOnly: true,
      });

      const res = await app.request('/dav/calendars/test-user-id/calendar-1/new-event.ics', {
        method: 'PUT',
        headers: {
          Authorization: basicAuth('test@example.com', 'test-password'),
          'Content-Type': 'text/calendar',
        },
        body: validICS,
      });

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /dav/calendars/{userId}/{calendarId}/{eventId}.ics', () => {
    it('should return 401 without authentication', async () => {
      setAuthState(false);

      const res = await app.request('/dav/calendars/test-user-id/calendar-1/event-1.ics', {
        method: 'DELETE',
      });

      expect(res.status).toBe(401);
    });

    it('should delete event and return 204', async () => {
      const res = await app.request('/dav/calendars/test-user-id/calendar-1/event-1.ics', {
        method: 'DELETE',
        headers: {
          Authorization: basicAuth('test@example.com', 'test-password'),
        },
      });

      expect(res.status).toBe(204);
    });

    it('should return 204 for non-existent event (idempotent)', async () => {
      mockDb.query.events.findFirst.mockResolvedValue(null);

      const res = await app.request('/dav/calendars/test-user-id/calendar-1/non-existent.ics', {
        method: 'DELETE',
        headers: {
          Authorization: basicAuth('test@example.com', 'test-password'),
        },
      });

      expect(res.status).toBe(204);
    });

    it('should return 412 on If-Match mismatch', async () => {
      const res = await app.request('/dav/calendars/test-user-id/calendar-1/event-1.ics', {
        method: 'DELETE',
        headers: {
          Authorization: basicAuth('test@example.com', 'test-password'),
          'If-Match': '"wrong-etag"',
        },
      });

      expect(res.status).toBe(412);
    });

    it('should return 403 for read-only calendar', async () => {
      mockDb.query.calendars.findFirst.mockResolvedValue({
        ...TEST_CALENDAR,
        isReadOnly: true,
      });

      const res = await app.request('/dav/calendars/test-user-id/calendar-1/event-1.ics', {
        method: 'DELETE',
        headers: {
          Authorization: basicAuth('test@example.com', 'test-password'),
        },
      });

      expect(res.status).toBe(403);
    });
  });

  describe('HEAD /dav/calendars/{userId}/{calendarId}/{eventId}.ics', () => {
    it('should return ETag without body', async () => {
      const res = await app.request('/dav/calendars/test-user-id/calendar-1/event-1.ics', {
        method: 'HEAD',
        headers: {
          Authorization: basicAuth('test@example.com', 'test-password'),
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('ETag')).toBe('"etag-abc123"');
    });
  });

  describe('REPORT /dav/calendars/{userId}/{calendarId}/', () => {
    it('should return 501 Not Implemented', async () => {
      const res = await app.request('/dav/calendars/test-user-id/calendar-1/', {
        method: 'REPORT',
        headers: {
          Authorization: basicAuth('test@example.com', 'test-password'),
        },
      });

      expect(res.status).toBe(501);
    });
  });

  describe('MKCALENDAR /dav/calendars/{userId}/{calendarId}/', () => {
    it('should return 501 Not Implemented', async () => {
      const res = await app.request('/dav/calendars/test-user-id/new-calendar/', {
        method: 'MKCALENDAR',
        headers: {
          Authorization: basicAuth('test@example.com', 'test-password'),
        },
      });

      expect(res.status).toBe(501);
    });
  });
});
