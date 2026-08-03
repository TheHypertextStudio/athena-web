/**
 * `@docket/api` — pure calendar row serializers.
 *
 * @remarks
 * These are shared across every calendar route (`me-calendar.ts`, the sync engine's read paths)
 * and are otherwise only exercised incidentally through the routes that call them. This file
 * proves each serializer directly: every nullable-Date-to-ISO-string branch (present and absent),
 * and the connection status fallback that keeps an unrecognized stored status from ever reaching
 * the wire unexplained.
 */
import { describe, expect, it } from 'vitest';

import {
  toCalendarConnectionOut,
  toCalendarEventOut,
  toCalendarListOut,
} from '../../src/routes/calendar-shared';

const NOW = new Date('2026-08-01T12:00:00.000Z');

describe('toCalendarConnectionOut', () => {
  const base = {
    id: 'conn_1',
    externalAccountId: 'ext_1',
    accountEmail: 'ada@example.com',
    accountName: 'Ada',
    accountPictureUrl: null,
    lastSyncedAt: null,
    lastError: null,
    scopeState: null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  it.each(['connected', 'error', 'disconnected'] as const)(
    'passes a recognized status (%s) through unchanged',
    (status) => {
      const out = toCalendarConnectionOut({ ...base, status } as never, { total: 3, enabled: 2 });
      expect(out.status).toBe(status);
      expect(out.calendarsTotal).toBe(3);
      expect(out.calendarsEnabled).toBe(2);
    },
  );

  it('falls back to "error" for an unrecognized stored status', () => {
    const out = toCalendarConnectionOut({ ...base, status: 'pending_migration' } as never, {
      total: 0,
      enabled: 0,
    });
    expect(out.status).toBe('error');
  });

  it('reports lastSyncedAt as an ISO string when present, and null when absent', () => {
    const withSync = toCalendarConnectionOut(
      { ...base, status: 'connected', lastSyncedAt: NOW } as never,
      { total: 1, enabled: 1 },
    );
    expect(withSync.lastSyncedAt).toBe(NOW.toISOString());

    const withoutSync = toCalendarConnectionOut({ ...base, status: 'connected' } as never, {
      total: 1,
      enabled: 1,
    });
    expect(withoutSync.lastSyncedAt).toBeNull();
  });

  it('defaults a missing scopeState to null', () => {
    const out = toCalendarConnectionOut({ ...base, status: 'connected' } as never, {
      total: 0,
      enabled: 0,
    });
    expect(out.scopeState).toBeNull();
  });
});

describe('toCalendarListOut', () => {
  const base = {
    id: 'cal_1',
    connectionId: 'conn_1',
    externalCalendarId: 'primary',
    title: 'Primary',
    description: null,
    timezone: 'America/Los_Angeles',
    color: null,
    accessRole: 'owner',
    primary: true,
    selected: true,
    visibleByDefault: true,
    lastError: null,
    updatedAt: NOW,
  };

  it('reports lastSyncedAt as an ISO string when present, and null when absent', () => {
    expect(toCalendarListOut({ ...base, lastSyncedAt: NOW } as never).lastSyncedAt).toBe(
      NOW.toISOString(),
    );
    expect(toCalendarListOut({ ...base, lastSyncedAt: null } as never).lastSyncedAt).toBeNull();
  });
});

describe('toCalendarEventOut', () => {
  const base = {
    id: 'evt_1',
    connectionId: 'conn_1',
    calendarId: 'cal_1',
    externalCalendarId: 'primary',
    externalEventId: 'ext_evt_1',
    status: 'confirmed',
    title: 'Design review',
    description: null,
    location: null,
    htmlLink: null,
    allDayStartDate: null,
    allDayEndDate: null,
    organizer: null,
    attendees: [],
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('reports startsAt/endsAt/updatedExternalAt as ISO strings when present', () => {
    const out = toCalendarEventOut({
      ...base,
      startsAt: NOW,
      endsAt: NOW,
      updatedExternalAt: NOW,
    } as never);
    expect(out.startsAt).toBe(NOW.toISOString());
    expect(out.endsAt).toBe(NOW.toISOString());
    expect(out.updatedExternalAt).toBe(NOW.toISOString());
  });

  it('reports startsAt/endsAt/updatedExternalAt as null when absent', () => {
    const out = toCalendarEventOut({
      ...base,
      startsAt: null,
      endsAt: null,
      updatedExternalAt: null,
    } as never);
    expect(out.startsAt).toBeNull();
    expect(out.endsAt).toBeNull();
    expect(out.updatedExternalAt).toBeNull();
  });

  it('defaults a missing organizer to null', () => {
    expect(
      toCalendarEventOut({ ...base, startsAt: null, endsAt: null } as never).organizer,
    ).toBeNull();
  });
});
