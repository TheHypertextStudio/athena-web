import { describe, expect, it } from 'vitest';

import { resizeScheduleInstantRange } from '@/components/scheduling';

describe('resizeScheduleInstantRange', () => {
  it('resolves the edited edge from the requested wall time across spring forward', () => {
    expect(
      resizeScheduleInstantRange({
        startsAt: '2026-03-08T09:30:00Z',
        endsAt: '2026-03-08T10:30:00Z',
        edge: 'end',
        targetDate: '2026-03-08',
        edgeMinutes: 180,
        displayTimezone: 'America/Los_Angeles',
      }),
    ).toEqual({
      startsAt: '2026-03-08T09:30:00Z',
      endsAt: '2026-03-08T10:00:00Z',
    });
  });

  it('rejects a repeated target when the edited edge has no fold occurrence', () => {
    expect(
      resizeScheduleInstantRange({
        startsAt: '2026-11-01T07:30:00Z',
        endsAt: '2026-11-01T10:30:00Z',
        edge: 'start',
        targetDate: '2026-11-01',
        edgeMinutes: 90,
        displayTimezone: 'America/Los_Angeles',
      }),
    ).toBeNull();
  });

  it.each([
    ['earlier', '2026-11-01T08:30:00Z', '2026-11-01T08:15:00Z'],
    ['later', '2026-11-01T09:30:00Z', '2026-11-01T09:15:00Z'],
  ])('preserves an exact %s occurrence while resizing inside the fold', (_, startsAt, expected) => {
    expect(
      resizeScheduleInstantRange({
        startsAt,
        endsAt: '2026-11-01T10:30:00Z',
        edge: 'start',
        targetDate: '2026-11-01',
        edgeMinutes: 75,
        displayTimezone: 'America/Los_Angeles',
      }),
    ).toEqual({ startsAt: expected, endsAt: '2026-11-01T10:30:00Z' });
  });

  it('rejects skipped wall targets and ranges that reverse exact order', () => {
    expect(
      resizeScheduleInstantRange({
        startsAt: '2026-03-08T09:30:00Z',
        endsAt: '2026-03-08T11:00:00Z',
        edge: 'start',
        targetDate: '2026-03-08',
        edgeMinutes: 150,
        displayTimezone: 'America/Los_Angeles',
      }),
    ).toBeNull();
    expect(
      resizeScheduleInstantRange({
        startsAt: '2026-07-13T09:00:00Z',
        endsAt: '2026-07-13T10:00:00Z',
        edge: 'start',
        targetDate: '2026-07-13',
        edgeMinutes: 600,
        displayTimezone: 'UTC',
      }),
    ).toBeNull();
  });

  it('normalizes a true end edge beyond local midnight onto the following date', () => {
    expect(
      resizeScheduleInstantRange({
        startsAt: '2026-07-13T23:00:00Z',
        endsAt: '2026-07-13T23:50:00Z',
        edge: 'end',
        targetDate: '2026-07-13',
        edgeMinutes: 24 * 60 + 10,
        displayTimezone: 'UTC',
      }),
    ).toEqual({
      startsAt: '2026-07-13T23:00:00Z',
      endsAt: '2026-07-14T00:10:00Z',
    });
  });
});
