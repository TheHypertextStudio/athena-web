import { describe, expect, it } from 'vitest';
import { WorkLocationAssertionId, WorkPlaceId } from '@docket/types';

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
    startsAt: allDay ? '2026-08-12T07:00:00.000Z' : '2026-08-12T16:00:00.000Z',
    endsAt: allDay ? '2026-08-13T07:00:00.000Z' : '2026-08-12T20:00:00.000Z',
    allDay,
    source: 'assertion',
    editable: true,
    assertionId,
    occurrenceDate: '2026-08-12',
    assertionKind,
  };
}

describe('work-location calendar edit payloads', () => {
  it('patches a one-off timed assertion when it moves or resizes', () => {
    expect(
      workLocationTimedEdit({
        region: region('one_off'),
        targetDate: '2026-08-13',
        startMinutes: 10 * 60,
        endMinutes: 15 * 60,
        timezone: 'America/Los_Angeles',
      }),
    ).toEqual({
      kind: 'assertion_patch',
      assertionId,
      input: {
        schedule: {
          type: 'one_off_timed',
          startsAt: '2026-08-13T17:00:00.000Z',
          endsAt: '2026-08-13T22:00:00.000Z',
          timezone: 'America/Los_Angeles',
        },
      },
    });
  });

  it('writes a replacement exception for a moved weekly timed occurrence', () => {
    expect(
      workLocationTimedEdit({
        region: region('weekly'),
        targetDate: '2026-08-14',
        startMinutes: 9 * 60,
        endMinutes: 12 * 60,
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
          endsAt: '2026-08-14T19:00:00.000Z',
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
        targetDate: '2026-08-13',
        startMinutes: 600,
        endMinutes: 660,
        timezone: 'UTC',
      }),
    ).toBeNull();
  });
});
