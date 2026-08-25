import { describe, expect, it } from 'vitest';
import {
  WorkLocationAssertionId,
  WorkPlaceId,
  type WorkLocationAssertionOut,
  type WorkLocationRangeOut,
  type WorkPlaceOut,
} from '@docket/types';
import { assertDefined } from '@docket/test-utils';

import { buildWorkLocationCalendarModel } from '@/components/work-location/work-location-calendar-model';

const PLACE_ID = WorkPlaceId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const ASSERTION_ID = WorkLocationAssertionId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ');

const place = {
  id: PLACE_ID,
  name: 'Main library',
  address: null,
  geofence: null,
  providerMappings: [],
  sort: 0,
  archivedAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
} satisfies WorkPlaceOut;

function assertion(schedule: WorkLocationAssertionOut['schedule']): WorkLocationAssertionOut {
  return {
    id: ASSERTION_ID,
    placeId: PLACE_ID,
    schedule,
    exceptions: [],
    origin: 'docket',
    originProvider: null,
    originConnectionId: null,
    revision: 1,
    archivedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

function range(segment: Partial<WorkLocationRangeOut['segments'][number]>): WorkLocationRangeOut {
  return {
    start: '2026-03-08T08:00:00.000Z',
    end: '2026-03-09T07:00:00.000Z',
    segments: [
      {
        place: { id: PLACE_ID, name: place.name },
        source: 'assertion',
        confidence: 'declared',
        effectiveStart: '2026-03-08T08:00:00.000Z',
        effectiveEnd: '2026-03-09T07:00:00.000Z',
        observedAt: null,
        expiresAt: null,
        assertionId: ASSERTION_ID,
        occurrenceDate: '2026-03-08',
        ...segment,
      },
    ],
  };
}

describe('buildWorkLocationCalendarModel', () => {
  it('recognizes a full civil day across the DST spring-forward boundary', () => {
    const model = buildWorkLocationCalendarModel({
      timezone: 'America/Los_Angeles',
      range: range({}),
      assertions: [
        assertion({
          type: 'one_off_all_day',
          date: '2026-03-08',
          timezone: 'America/Los_Angeles',
        }),
      ],
      places: [place],
      homePlaceId: PLACE_ID,
    });

    expect(model.regions).toEqual([
      expect.objectContaining({
        id: `${ASSERTION_ID}:2026-03-08:2026-03-08T08:00:00.000Z`,
        label: 'Main library',
        isHome: true,
        allDay: true,
        editable: true,
        assertionKind: 'one_off',
        assertionId: ASSERTION_ID,
        occurrenceDate: '2026-03-08',
      }),
    ]);
  });

  it('normalizes partial-day assertions and keeps inferred regions read-only', () => {
    const timed = range({
      effectiveStart: '2026-03-08T16:00:00.000Z',
      effectiveEnd: '2026-03-08T20:00:00.000Z',
      occurrenceDate: '2026-03-08',
    });
    timed.start = timed.segments[0]?.effectiveStart ?? timed.start;
    timed.end = timed.segments[0]?.effectiveEnd ?? timed.end;
    const declared = buildWorkLocationCalendarModel({
      timezone: 'America/Los_Angeles',
      range: timed,
      assertions: [
        assertion({
          type: 'weekly_timed',
          effectiveFrom: '2026-03-01',
          effectiveUntil: null,
          weekdays: [6],
          startMinute: 540,
          endMinute: 780,
          timezone: 'America/Los_Angeles',
        }),
      ],
      places: [place],
    });
    const inferred = buildWorkLocationCalendarModel({
      timezone: 'America/Los_Angeles',
      range: range({
        source: 'bridged_work_blocks',
        confidence: 'inferred',
        assertionId: null,
        occurrenceDate: null,
      }),
      assertions: [],
      places: [place],
    });

    expect(declared.regions[0]).toMatchObject({
      allDay: false,
      editable: true,
      assertionKind: 'weekly',
      ownsStart: true,
      ownsEnd: true,
    });
    expect(inferred.regions[0]).toMatchObject({
      editable: false,
      assertionKind: null,
      assertionId: null,
      ownsStart: false,
      ownsEnd: false,
    });
  });

  it('marks only resolved fragments that retain the assertion occurrence endpoints', () => {
    const source = assertion({
      type: 'one_off_timed',
      startsAt: '2026-08-12T23:00:00.000Z',
      endsAt: '2026-08-14T01:00:00.000Z',
      timezone: 'UTC',
    });
    const splitRange = range({
      effectiveStart: '2026-08-12T23:00:00.000Z',
      effectiveEnd: '2026-08-13T12:00:00.000Z',
      occurrenceDate: '2026-08-12',
    });
    splitRange.start = '2026-08-12T00:00:00.000Z';
    splitRange.end = '2026-08-15T00:00:00.000Z';
    splitRange.segments.push({
      ...assertDefined(splitRange.segments[0]),
      effectiveStart: '2026-08-13T15:00:00.000Z',
      effectiveEnd: '2026-08-14T01:00:00.000Z',
    });

    const model = buildWorkLocationCalendarModel({
      timezone: 'UTC',
      range: splitRange,
      assertions: [source],
      places: [place],
    });

    expect(model.regions).toEqual([
      expect.objectContaining({
        ownsStart: true,
        ownsEnd: false,
        sourceStartsAt: '2026-08-12T23:00:00.000Z',
        sourceEndsAt: '2026-08-14T01:00:00.000Z',
      }),
      expect.objectContaining({
        ownsStart: false,
        ownsEnd: true,
        sourceStartsAt: '2026-08-12T23:00:00.000Z',
        sourceEndsAt: '2026-08-14T01:00:00.000Z',
      }),
    ]);
  });

  it('keeps an all-day assertion as one chip when a timed winner splits its resolved fragments', () => {
    const split = range({
      effectiveStart: '2026-03-08T08:00:00.000Z',
      effectiveEnd: '2026-03-08T16:00:00.000Z',
    });
    split.segments.push({
      ...assertDefined(split.segments[0]),
      effectiveStart: '2026-03-08T20:00:00.000Z',
      effectiveEnd: '2026-03-09T07:00:00.000Z',
    });

    const model = buildWorkLocationCalendarModel({
      timezone: 'America/Los_Angeles',
      range: split,
      assertions: [
        assertion({
          type: 'one_off_all_day',
          date: '2026-03-08',
          timezone: 'America/Los_Angeles',
        }),
      ],
      places: [place],
    });

    expect(model.regions).toEqual([
      expect.objectContaining({
        allDay: true,
        startsAt: '2026-03-08T08:00:00.000Z',
        endsAt: '2026-03-09T07:00:00.000Z',
      }),
    ]);
  });

  it('anchors provider all-day dates to the display timezone', () => {
    const model = buildWorkLocationCalendarModel({
      timezone: 'America/Los_Angeles',
      range: range({
        effectiveStart: '2026-03-08T08:00:00.000Z',
        effectiveEnd: '2026-03-09T00:00:00.000Z',
      }),
      assertions: [
        assertion({
          type: 'one_off_all_day',
          date: '2026-03-08',
          timezone: 'UTC',
        }),
      ],
      places: [place],
    });

    expect(model.regions).toEqual([
      expect.objectContaining({
        allDay: true,
        startsAt: '2026-03-08T08:00:00.000Z',
        endsAt: '2026-03-09T07:00:00.000Z',
        sourceStartsAt: '2026-03-08T00:00:00.000Z',
        sourceEndsAt: '2026-03-09T00:00:00.000Z',
      }),
    ]);
  });
});
