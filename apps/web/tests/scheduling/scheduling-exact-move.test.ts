import { describe, expect, it } from 'vitest';

import { moveScheduleInstantRange } from '@/components/scheduling';

describe('moveScheduleInstantRange', () => {
  it('preserves elapsed duration when moving an event away from a repeated hour', () => {
    expect(
      moveScheduleInstantRange({
        startsAt: '2026-11-01T07:30:00Z',
        endsAt: '2026-11-01T09:30:00Z',
        targetDate: '2026-11-01',
        startMinutes: 180,
        displayTimezone: 'America/Los_Angeles',
      }),
    ).toEqual({
      startsAt: '2026-11-01T11:00:00Z',
      endsAt: '2026-11-01T13:00:00Z',
    });
  });

  it('rejects a repeated target when the source has no explicit fold occurrence', () => {
    expect(
      moveScheduleInstantRange({
        startsAt: '2026-11-01T07:30:00Z',
        endsAt: '2026-11-01T09:30:00Z',
        targetDate: '2026-11-01',
        startMinutes: 90,
        displayTimezone: 'America/Los_Angeles',
      }),
    ).toBeNull();
  });

  it.each([
    {
      occurrence: 'earlier',
      startsAt: '2026-11-01T08:30:00Z',
      endsAt: '2026-11-01T10:30:00Z',
      movedStartsAt: '2026-11-01T08:15:00Z',
      movedEndsAt: '2026-11-01T10:15:00Z',
    },
    {
      occurrence: 'later',
      startsAt: '2026-11-01T09:30:00Z',
      endsAt: '2026-11-01T10:30:00Z',
      movedStartsAt: '2026-11-01T09:15:00Z',
      movedEndsAt: '2026-11-01T10:15:00Z',
    },
  ])('preserves an exact $occurrence fold occurrence', (example) => {
    expect(
      moveScheduleInstantRange({
        startsAt: example.startsAt,
        endsAt: example.endsAt,
        targetDate: '2026-11-01',
        startMinutes: 75,
        displayTimezone: 'America/Los_Angeles',
      }),
    ).toEqual({
      startsAt: example.movedStartsAt,
      endsAt: example.movedEndsAt,
    });
  });

  it('still rejects a skipped target start', () => {
    expect(
      moveScheduleInstantRange({
        startsAt: '2026-03-08T09:00:00Z',
        endsAt: '2026-03-08T10:00:00Z',
        targetDate: '2026-03-08',
        startMinutes: 150,
        displayTimezone: 'America/Los_Angeles',
      }),
    ).toBeNull();
  });
});
