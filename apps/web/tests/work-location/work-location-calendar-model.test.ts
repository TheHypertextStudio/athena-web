import { describe, expect, it } from 'vitest';
import {
  WorkLocationAssertionId,
  WorkPlaceId,
  type WorkLocationAssertionOut,
  type WorkLocationRangeOut,
  type WorkLocationSyncAccountOut,
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

function account(overrides: Partial<WorkLocationSyncAccountOut>): WorkLocationSyncAccountOut {
  return {
    connectionId: '01BX5ZZKBKACTAV9WEVGEMMVS0' as WorkLocationSyncAccountOut['connectionId'],
    provider: 'google',
    accountLabel: 'willie@example.com',
    state: 'healthy',
    reason: null,
    capabilities: {
      scheduledIntervals: true,
      partialDays: true,
      weeklyRecurrence: true,
      currentPresence: false,
      providerPlaceIds: true,
      inboundChanges: true,
      writes: true,
    },
    bootstrapCompletedAt: null,
    lastSucceededAt: null,
    pendingWrites: 0,
    ...overrides,
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
      accounts: [],
    });

    expect(model.regions).toEqual([
      expect.objectContaining({
        id: `${ASSERTION_ID}:2026-03-08:2026-03-08T08:00:00.000Z`,
        label: 'Main library',
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
          startMinute: 480,
          endMinute: 720,
          timezone: 'America/Los_Angeles',
        }),
      ],
      places: [place],
      accounts: [],
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
      accounts: [],
    });

    expect(declared.regions[0]).toMatchObject({
      allDay: false,
      editable: true,
      assertionKind: 'weekly',
    });
    expect(inferred.regions[0]).toMatchObject({
      editable: false,
      assertionKind: null,
      assertionId: null,
    });
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
      accounts: [],
    });

    expect(model.regions).toEqual([
      expect.objectContaining({
        allDay: true,
        startsAt: '2026-03-08T08:00:00.000Z',
        endsAt: '2026-03-09T07:00:00.000Z',
      }),
    ]);
  });

  it('deduplicates provider warnings while retaining account labels', () => {
    const duplicate = account({ state: 'action_required', reason: 'missing_scope' });
    const model = buildWorkLocationCalendarModel({
      timezone: 'UTC',
      range: { start: '2026-08-14T00:00:00.000Z', end: '2026-08-15T00:00:00.000Z', segments: [] },
      assertions: [],
      places: [],
      accounts: [
        duplicate,
        duplicate,
        account({
          connectionId: '01BX5ZZKBKACTAV9WEVGEMMVS1' as WorkLocationSyncAccountOut['connectionId'],
          accountLabel: 'studio@example.com',
          state: 'retrying',
          reason: 'provider_unavailable',
        }),
      ],
    });

    expect(model.warnings).toEqual([
      expect.objectContaining({
        label: 'willie@example.com',
        message: 'Location sync needs attention.',
      }),
      expect.objectContaining({
        label: 'studio@example.com',
        message: 'Location sync is retrying.',
      }),
    ]);
  });
});
