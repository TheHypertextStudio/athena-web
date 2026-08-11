import { describe, expect, it } from 'vitest';

import { normalizeCalendarProviderEventType } from '../src/calendar/calendar-provider-event-type';
import { toCalendarItemOut } from '../src/calendar/calendar-serializers';

describe('normalizeCalendarProviderEventType', () => {
  it.each([
    ['default', 'default'],
    ['workingLocation', 'working_location'],
    ['focusTime', 'focus_time'],
    ['outOfOffice', 'out_of_office'],
    ['birthday', 'birthday'],
    ['fromGmail', 'from_gmail'],
  ] as const)('maps Google %s semantics to %s', (raw, expected) => {
    expect(normalizeCalendarProviderEventType({ eventType: raw })).toBe(expected);
  });

  it('omits missing, malformed, and unknown provider semantics', () => {
    expect(normalizeCalendarProviderEventType(null)).toBeNull();
    expect(normalizeCalendarProviderEventType({ eventType: 3 })).toBeNull();
    expect(normalizeCalendarProviderEventType({ eventType: 'newProviderType' })).toBeNull();
  });

  it('includes normalized semantics in a serialized calendar item', () => {
    const row = {
      id: '01BX5ZZKBKACTAV9WEVGEMMVS0',
      userId: 'user-1',
      layerId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      connectionId: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
      kind: 'provider_event',
      provider: 'google',
      externalCalendarId: 'primary',
      externalEventId: 'working-location-1',
      recurringEventId: null,
      recurrenceInstanceKey: null,
      status: 'confirmed',
      title: 'Home',
      description: null,
      location: null,
      htmlLink: null,
      startsAt: null,
      endsAt: null,
      allDayStartDate: '2026-08-10',
      allDayEndDate: '2026-08-11',
      timezone: 'America/Los_Angeles',
      endTimezone: 'America/New_York',
      organizer: null,
      attendees: [],
      providerRaw: { eventType: 'workingLocation' },
      permissions: { canEditCore: false, canDelete: false, readOnlyReason: 'provider_scope' },
      updatedExternalAt: null,
      externalEtag: null,
      externalSequence: null,
      lastPushedAt: null,
      syncState: 'clean',
      conflict: null,
      workShape: null,
      origin: 'provider',
      scheduleRunId: null,
      organizationId: null,
      archivedAt: null,
      createdAt: new Date('2026-08-10T08:00:00.000Z'),
      updatedAt: new Date('2026-08-10T08:00:00.000Z'),
    } as unknown as Parameters<typeof toCalendarItemOut>[0];

    const serialized = toCalendarItemOut(row, { linkedTasks: [] });
    expect(serialized.providerEventType).toBe('working_location');
    expect(serialized.endTimezone).toBe('America/New_York');
  });
});
