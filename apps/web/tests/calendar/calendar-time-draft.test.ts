import { describe, expect, it } from 'vitest';

import {
  applyCalendarDraftTimezones,
  calendarTimeDraftFromSeed,
  rebaseCalendarTimeDraft,
  resolveCalendarTimeDraft,
  updateCalendarDraftEnd,
  updateCalendarDraftStart,
} from '../../src/components/calendar/calendar-time-draft';

const SEED = {
  startsAt: '2026-08-10T17:00:00.000Z',
  endsAt: '2026-08-10T18:00:00.000Z',
};

describe('calendar time draft', () => {
  it('splits exact seed instants into separate wall dates and times', () => {
    const draft = calendarTimeDraftFromSeed(SEED, 'America/Los_Angeles');
    expect(draft.start).toMatchObject({ date: '2026-08-10', time: '10:00', edited: false });
    expect(draft.end).toMatchObject({ date: '2026-08-10', time: '11:00', edited: false });
    expect(draft.startTimezone).toBe('America/Los_Angeles');
    expect(draft.endTimezone).toBe('America/Los_Angeles');
  });

  it('preserves wall values while applying independent start and end zones', () => {
    const draft = calendarTimeDraftFromSeed(SEED, 'America/Los_Angeles');
    const withEndWall = updateCalendarDraftEnd(draft, {
      date: '2026-08-10',
      time: '14:00',
    });
    const zoned = applyCalendarDraftTimezones(
      withEndWall,
      'America/Los_Angeles',
      'America/New_York',
    );

    expect(resolveCalendarTimeDraft(zoned)).toEqual({
      startsAt: '2026-08-10T17:00:00Z',
      endsAt: '2026-08-10T18:00:00Z',
      timezone: 'America/Los_Angeles',
      endTimezone: 'America/New_York',
    });
  });

  it('identifies a daylight-saving gap without returning visible recovery copy', () => {
    const draft = updateCalendarDraftStart(calendarTimeDraftFromSeed(SEED, 'America/Los_Angeles'), {
      date: '2026-03-08',
      time: '02:30',
    });
    expect(resolveCalendarTimeDraft(draft)).toEqual({ invalidField: 'start' });
  });

  it('requires an occurrence choice for an edited repeated wall time', () => {
    const draft = updateCalendarDraftStart(calendarTimeDraftFromSeed(SEED, 'America/Los_Angeles'), {
      date: '2026-11-01',
      time: '01:30',
    });
    expect(resolveCalendarTimeDraft(draft)).toEqual({ invalidField: 'start' });

    const later = updateCalendarDraftEnd(
      updateCalendarDraftStart(draft, {
        date: '2026-11-01',
        time: '01:30',
        occurrence: 'later',
      }),
      { date: '2026-11-01', time: '03:00' },
    );
    expect(resolveCalendarTimeDraft(later)).toMatchObject({
      startsAt: '2026-11-01T09:30:00Z',
    });
  });

  it('rebases untouched fields and zones while preserving edited wall values', () => {
    const edited = updateCalendarDraftStart(calendarTimeDraftFromSeed(SEED, 'UTC'), {
      date: '2026-08-10',
      time: '20:00',
    });
    const rebased = rebaseCalendarTimeDraft(edited, 'Asia/Tokyo');
    expect(rebased.start).toMatchObject({ date: '2026-08-10', time: '20:00', edited: true });
    expect(rebased.end).toMatchObject({ date: '2026-08-11', time: '03:00', edited: false });
    expect(rebased.startTimezone).toBe('Asia/Tokyo');
  });
});
