import { describe, expect, it } from 'vitest';
import { toCalendarItemOut } from '../src/calendar/calendar-serializers';
import { toCalendarEventOut } from '../src/routes/calendar-shared';

function item(providerRaw: Record<string, unknown> | null, allDay = false) {
  return {
    kind: 'provider_event',
    provider: 'google',
    status: 'confirmed',
    syncState: 'clean',
    providerRaw,
    permissions: null,
    conflict: null,
    title: 'Calendar context',
    startsAt: allDay ? null : new Date('2026-10-07T16:00:00Z'),
    endsAt: allDay ? null : new Date('2026-10-07T17:00:00Z'),
    allDayStartDate: allDay ? '2026-10-07' : null,
    allDayEndDate: allDay ? '2026-10-08' : null,
    createdAt: new Date('2026-10-07T00:00:00Z'),
    updatedAt: new Date('2026-10-07T00:00:00Z'),
  } as unknown as Parameters<typeof toCalendarItemOut>[0];
}

describe('calendar availability serialization', () => {
  it.each([
    ['transparent timed', { transparency: 'transparent' }, false, false],
    ['transparent all-day', { transparency: 'transparent' }, true, false],
    ['working location', { eventType: 'workingLocation' }, true, false],
    [
      'opaque working location',
      { eventType: 'workingLocation', transparency: 'opaque' },
      true,
      false,
    ],
    ['opaque all-day', { transparency: 'opaque' }, true, true],
    ['out of office', { eventType: 'outOfOffice', transparency: 'opaque' }, false, true],
    ['missing provider snapshot', null, true, true],
    ['missing transparency', {}, true, true],
    ['malformed transparency', { transparency: false }, true, true],
  ] as const)(
    'reports %s without exposing provider payloads',
    (_label, raw, allDay, blocksTime) => {
      const serialized = toCalendarItemOut(item(raw, allDay), { linkedTasks: [] });
      expect(serialized).toHaveProperty('blocksTime', blocksTime);
      expect(serialized.title).toBe('Calendar context');
      expect(serialized).not.toHaveProperty('providerRaw');
    },
  );

  it.each(['native_event', 'native_block', 'timebox', 'task_timebox'])(
    'keeps native busy %s reserved regardless of stale provider data',
    (kind) => {
      const serialized = toCalendarItemOut(
        { ...item({ transparency: 'transparent' }), kind },
        { linkedTasks: [] },
      );
      expect(serialized).toHaveProperty('blocksTime', true);
    },
  );

  it('reports computed availability as free', () => {
    expect(
      toCalendarItemOut({ ...item(null), kind: 'availability_block' }, { linkedTasks: [] }),
    ).toHaveProperty('blocksTime', false);
  });

  it('keeps legacy all-day rows without provider metadata busy', () => {
    const legacy = toCalendarEventOut(
      item(null, true) as unknown as Parameters<typeof toCalendarEventOut>[0],
    );
    expect(legacy).toHaveProperty('blocksTime', true);
  });
});
