import { describe, expect, it } from 'vitest';
import { WorkLocationAssertionId, WorkPlaceId } from '@docket/planning/ids';

import {
  workLocationAllDayMove,
  workLocationTimedEdit,
} from '@/components/work-location/work-location-calendar-editing';
import type { WorkLocationCalendarRegion } from '@/components/work-location/work-location-calendar-model';

const assertionId = WorkLocationAssertionId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ');
const placeId = WorkPlaceId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV');

function region(
  assertionKind: WorkLocationCalendarRegion['assertionKind'],
  allDay = false,
): WorkLocationCalendarRegion {
  return {
    id: 'region',
    placeId,
    label: 'Main library',
    isHome: false,
    startsAt: allDay ? '2026-08-12T07:00:00.000Z' : '2026-08-12T16:00:00.000Z',
    endsAt: allDay ? '2026-08-13T07:00:00.000Z' : '2026-08-12T20:00:00.000Z',
    sourceStartsAt: allDay ? '2026-08-12T07:00:00.000Z' : '2026-08-12T16:00:00.000Z',
    sourceEndsAt: allDay ? '2026-08-13T07:00:00.000Z' : '2026-08-12T20:00:00.000Z',
    allDay,
    source: 'assertion',
    editable: true,
    assertionId,
    occurrenceDate: '2026-08-12',
    assertionKind,
    ownsStart: true,
    ownsEnd: true,
  };
}

describe('work-location calendar edit payloads', () => {
  it('patches a one-off timed assertion when it moves or resizes', () => {
    expect(
      workLocationTimedEdit({
        region: region('one_off'),
        mode: 'move',
        sourceDate: '2026-08-12',
        sourceStartMinutes: 9 * 60,
        sourceEndMinutes: 13 * 60,
        targetDate: '2026-08-13',
        startMinutes: 10 * 60,
        endMinutes: 14 * 60,
        timezone: 'America/Los_Angeles',
      }),
    ).toEqual({
      kind: 'assertion_patch',
      assertionId,
      input: {
        schedule: {
          type: 'one_off_timed',
          startsAt: '2026-08-13T17:00:00.000Z',
          endsAt: '2026-08-13T21:00:00.000Z',
          timezone: 'America/Los_Angeles',
        },
      },
    });
  });

  it('writes a replacement exception for a moved weekly timed occurrence', () => {
    expect(
      workLocationTimedEdit({
        region: region('weekly'),
        mode: 'move',
        sourceDate: '2026-08-12',
        sourceStartMinutes: 9 * 60,
        sourceEndMinutes: 13 * 60,
        targetDate: '2026-08-14',
        startMinutes: 9 * 60,
        endMinutes: 13 * 60,
        timezone: 'America/Los_Angeles',
      }),
    ).toEqual({
      kind: 'occurrence_replace',
      assertionId,
      occurrenceDate: '2026-08-12',
      input: {
        action: 'replace',
        date: '2026-08-12',
        placeId,
        schedule: {
          type: 'one_off_timed',
          startsAt: '2026-08-14T16:00:00.000Z',
          endsAt: '2026-08-14T20:00:00.000Z',
          timezone: 'America/Los_Angeles',
        },
      },
    });
  });

  it('patches one-off all-day assertions and replaces weekly occurrences on date moves', () => {
    expect(
      workLocationAllDayMove({
        region: region('one_off', true),
        targetDate: '2026-08-15',
        timezone: 'America/Los_Angeles',
      }),
    ).toEqual({
      kind: 'assertion_patch',
      assertionId,
      input: {
        schedule: {
          type: 'one_off_all_day',
          date: '2026-08-15',
          timezone: 'America/Los_Angeles',
        },
      },
    });
    expect(
      workLocationAllDayMove({
        region: region('weekly', true),
        targetDate: '2026-08-15',
        timezone: 'America/Los_Angeles',
      }),
    ).toMatchObject({
      kind: 'occurrence_replace',
      occurrenceDate: '2026-08-12',
      input: {
        action: 'replace',
        date: '2026-08-12',
        placeId,
        schedule: { type: 'one_off_all_day', date: '2026-08-15' },
      },
    });
  });

  it('refuses edits for inferred or incomplete regions', () => {
    expect(
      workLocationTimedEdit({
        region: { ...region(null), editable: false, assertionId: null, occurrenceDate: null },
        mode: 'move',
        sourceDate: '2026-08-12',
        sourceStartMinutes: 600,
        sourceEndMinutes: 660,
        targetDate: '2026-08-13',
        startMinutes: 600,
        endMinutes: 660,
        timezone: 'UTC',
      }),
    ).toBeNull();
  });

  it('preserves the selected occurrence when fall-back repeats the edited wall time', () => {
    const earlier = {
      ...region('one_off'),
      startsAt: '2026-11-01T08:30:00.000Z',
      endsAt: '2026-11-01T10:30:00.000Z',
      sourceStartsAt: '2026-11-01T08:30:00.000Z',
      sourceEndsAt: '2026-11-01T10:30:00.000Z',
      occurrenceDate: '2026-11-01',
    };
    const later = {
      ...earlier,
      startsAt: '2026-11-01T09:30:00.000Z',
      endsAt: '2026-11-01T11:30:00.000Z',
      sourceStartsAt: '2026-11-01T09:30:00.000Z',
      sourceEndsAt: '2026-11-01T11:30:00.000Z',
    };

    const edit = (source: WorkLocationCalendarRegion) =>
      workLocationTimedEdit({
        region: source,
        mode: 'move',
        sourceDate: '2026-11-01',
        sourceStartMinutes: 90,
        sourceEndMinutes: 150,
        targetDate: '2026-11-01',
        startMinutes: 75,
        endMinutes: 135,
        timezone: 'America/Los_Angeles',
      });

    expect(edit(earlier)).toMatchObject({
      input: {
        schedule: {
          startsAt: '2026-11-01T08:15:00.000Z',
          endsAt: '2026-11-01T10:15:00.000Z',
        },
      },
    });
    expect(edit(later)).toMatchObject({
      input: {
        schedule: {
          startsAt: '2026-11-01T09:15:00.000Z',
          endsAt: '2026-11-01T11:15:00.000Z',
        },
      },
    });
  });

  it('rejects a repeated target when the source endpoint has no occurrence identity', () => {
    expect(
      workLocationTimedEdit({
        region: region('one_off'),
        mode: 'move',
        sourceDate: '2026-08-12',
        sourceStartMinutes: 9 * 60,
        sourceEndMinutes: 13 * 60,
        targetDate: '2026-11-01',
        startMinutes: 90,
        endMinutes: 330,
        timezone: 'America/Los_Angeles',
      }),
    ).toBeNull();
  });

  it('preserves repeated start and end occurrence identity while resizing', () => {
    const earlierStart = {
      ...region('one_off'),
      startsAt: '2026-11-01T08:30:00.000Z',
      endsAt: '2026-11-01T10:30:00.000Z',
      sourceStartsAt: '2026-11-01T08:30:00.000Z',
      sourceEndsAt: '2026-11-01T10:30:00.000Z',
      occurrenceDate: '2026-11-01',
    };
    const laterEnd = {
      ...region('one_off'),
      startsAt: '2026-11-01T07:30:00.000Z',
      endsAt: '2026-11-01T09:30:00.000Z',
      sourceStartsAt: '2026-11-01T07:30:00.000Z',
      sourceEndsAt: '2026-11-01T09:30:00.000Z',
      occurrenceDate: '2026-11-01',
    };

    expect(
      workLocationTimedEdit({
        region: earlierStart,
        mode: 'resize-start',
        sourceDate: '2026-11-01',
        sourceStartMinutes: 90,
        sourceEndMinutes: 150,
        targetDate: '2026-11-01',
        startMinutes: 75,
        endMinutes: 150,
        timezone: 'America/Los_Angeles',
      }),
    ).toMatchObject({
      input: {
        schedule: {
          startsAt: '2026-11-01T08:15:00.000Z',
          endsAt: '2026-11-01T10:30:00.000Z',
        },
      },
    });
    expect(
      workLocationTimedEdit({
        region: laterEnd,
        mode: 'resize-end',
        sourceDate: '2026-11-01',
        sourceStartMinutes: 30,
        sourceEndMinutes: 90,
        targetDate: '2026-11-01',
        startMinutes: 30,
        endMinutes: 75,
        timezone: 'America/Los_Angeles',
      }),
    ).toMatchObject({
      input: {
        schedule: {
          startsAt: '2026-11-01T07:30:00.000Z',
          endsAt: '2026-11-01T09:15:00.000Z',
        },
      },
    });
  });

  it('moves and resizes a lane-clipped cross-midnight interval by its applied delta', () => {
    const crossMidnight = {
      ...region('one_off'),
      startsAt: '2026-08-12T23:00:00.000Z',
      endsAt: '2026-08-14T01:00:00.000Z',
      sourceStartsAt: '2026-08-12T23:00:00.000Z',
      sourceEndsAt: '2026-08-14T01:00:00.000Z',
      occurrenceDate: '2026-08-12',
    };
    const base = {
      region: crossMidnight,
      sourceDate: '2026-08-13',
      sourceStartMinutes: 0,
      sourceEndMinutes: 1_440,
      targetDate: '2026-08-13',
      timezone: 'UTC',
    } as const;

    expect(
      workLocationTimedEdit({
        ...base,
        mode: 'move',
        startMinutes: 15,
        endMinutes: 1_440,
      }),
    ).toMatchObject({
      input: {
        schedule: {
          startsAt: '2026-08-12T23:15:00.000Z',
          endsAt: '2026-08-14T01:15:00.000Z',
        },
      },
    });
    expect(
      workLocationTimedEdit({
        ...base,
        mode: 'resize-start',
        startMinutes: 15,
        endMinutes: 1_440,
      }),
    ).toMatchObject({
      input: {
        schedule: {
          startsAt: '2026-08-12T23:15:00.000Z',
          endsAt: '2026-08-14T01:00:00.000Z',
        },
      },
    });
    expect(
      workLocationTimedEdit({
        ...base,
        mode: 'resize-end',
        startMinutes: 0,
        endMinutes: 1_425,
      }),
    ).toMatchObject({
      input: {
        schedule: {
          startsAt: '2026-08-12T23:00:00.000Z',
          endsAt: '2026-08-14T00:45:00.000Z',
        },
      },
    });
  });

  it('preserves the hidden source endpoint when resizing a precedence-clipped fragment', () => {
    const clipped = {
      ...region('one_off'),
      startsAt: '2026-08-12T23:00:00.000Z',
      endsAt: '2026-08-13T12:00:00.000Z',
      sourceStartsAt: '2026-08-12T23:00:00.000Z',
      sourceEndsAt: '2026-08-14T01:00:00.000Z',
      ownsStart: true,
      ownsEnd: false,
    };

    expect(
      workLocationTimedEdit({
        region: clipped,
        mode: 'resize-start',
        sourceDate: '2026-08-12',
        sourceStartMinutes: 1_380,
        sourceEndMinutes: 1_440,
        targetDate: '2026-08-12',
        startMinutes: 1_395,
        endMinutes: 1_440,
        timezone: 'UTC',
      }),
    ).toMatchObject({
      input: {
        schedule: {
          startsAt: '2026-08-12T23:15:00.000Z',
          endsAt: '2026-08-14T01:00:00.000Z',
        },
      },
    });
  });
});
