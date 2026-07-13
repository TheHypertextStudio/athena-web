import {
  ActorId,
  CalendarItemId,
  type CalendarItemOut,
  CalendarLayerId,
  type ScheduleComparisonOut,
} from '@docket/types';
import { describe, expect, it } from 'vitest';

import {
  dateRange,
  buildComparisonLane,
  buildDateLane,
  deriveRollingDateWindow,
  overlapsDate,
  toScheduleItem,
} from '../../src/app/(app)/calendar/calendar-schedule-model';
import { itemBoundsInLane } from '../../src/components/scheduling/scheduling-date-lanes';

const ITEM_ID = CalendarItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVS1');
const LAYER_ID = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVN1');

/** Build one editable timed item for viewer-timezone model tests. */
function calendarItem(overrides: Partial<CalendarItemOut> = {}): CalendarItemOut {
  return {
    id: ITEM_ID,
    layerId: LAYER_ID,
    connectionId: null,
    kind: 'native_block',
    provider: null,
    externalCalendarId: null,
    externalEventId: null,
    recurringEventId: null,
    recurrenceInstanceKey: null,
    status: 'confirmed',
    title: 'Focus block',
    description: null,
    location: null,
    htmlLink: null,
    startsAt: '2026-07-02T06:30:00Z',
    endsAt: '2026-07-02T07:30:00Z',
    allDayStartDate: null,
    allDayEndDate: null,
    timezone: null,
    organizer: null,
    attendees: [],
    permissions: { canEditCore: true, canDelete: true, readOnlyReason: null },
    syncState: 'clean',
    hasConflict: false,
    updatedExternalAt: null,
    archivedAt: null,
    linkedTasks: [],
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

describe('deriveRollingDateWindow', () => {
  it.each([
    { visibleLaneCount: 1, expectedStart: '2026-07-11', expectedLanes: 3 },
    { visibleLaneCount: 3, expectedStart: '2026-07-09', expectedLanes: 9 },
    { visibleLaneCount: 8, expectedStart: '2026-07-04', expectedLanes: 24 },
  ])(
    'scales one-viewport overscan for $visibleLaneCount measured lanes',
    ({ visibleLaneCount, expectedStart, expectedLanes }) => {
      expect(deriveRollingDateWindow('2026-07-12', visibleLaneCount)).toEqual({
        startDate: expectedStart,
        laneCount: expectedLanes,
        initialLaneIndex: visibleLaneCount,
      });
    },
  );

  it('accepts a different viewport overscan policy without changing visible-lane semantics', () => {
    expect(deriveRollingDateWindow('2026-07-12', 4, { overscanViewports: 2 })).toEqual({
      startDate: '2026-07-04',
      laneCount: 20,
      initialLaneIndex: 8,
    });
    expect(deriveRollingDateWindow('2026-07-12', 4, { overscanViewports: 0 })).toEqual({
      startDate: '2026-07-12',
      laneCount: 4,
      initialLaneIndex: 0,
    });
  });

  it('normalizes invalid geometry inputs to one usable lane', () => {
    expect(deriveRollingDateWindow('2026-07-12', 0)).toEqual({
      startDate: '2026-07-11',
      laneCount: 3,
      initialLaneIndex: 1,
    });
  });
});

describe('calendar schedule timezone model', () => {
  it('derives date-query boundaries from the supplied Hub timezone', () => {
    expect(dateRange('2026-03-08', 1, 'America/New_York')).toEqual({
      startISO: '2026-03-08T05:00:00Z',
      endISO: '2026-03-09T04:00:00Z',
    });
  });

  it('checks timed overlap against viewer-zone lane boundaries', () => {
    const item = calendarItem({
      startsAt: '2026-07-02T00:30:00Z',
      endsAt: '2026-07-02T01:30:00Z',
    });

    expect(overlapsDate(item, '2026-07-01', 'America/Los_Angeles')).toBe(true);
    expect(overlapsDate(item, '2026-07-02', 'America/Los_Angeles')).toBe(false);
    expect(overlapsDate(item, '2026-07-02', 'UTC')).toBe(true);
  });

  it('uses the viewer zone for same-day editability and all-day fallback instants', () => {
    expect(toScheduleItem(calendarItem(), '2026-07-02', null, 'Asia/Tokyo')).toMatchObject({
      editable: true,
    });

    const allDay = toScheduleItem(
      calendarItem({
        startsAt: null,
        endsAt: null,
        allDayStartDate: '2026-07-01',
        allDayEndDate: '2026-07-02',
      }),
      '2026-07-01',
      null,
      'Asia/Tokyo',
    );
    expect(allDay).toMatchObject({
      startsAt: '2026-06-30T15:00:00Z',
      endsAt: '2026-07-01T15:00:00Z',
      allDay: true,
    });
  });

  it('builds date and resource lanes with viewer-zone membership and metadata-only resource zones', () => {
    const timed = calendarItem({
      startsAt: '2026-07-01T23:30:00Z',
      endsAt: '2026-07-02T00:30:00Z',
    });
    const dateLane = buildDateLane('2026-07-02', [timed], new Map(), 'Asia/Tokyo');
    expect(dateLane.items).toHaveLength(1);
    expect(itemBoundsInLane(dateLane.items[0]!, dateLane, 'Asia/Tokyo')).toEqual({
      startMinutes: 510,
      endMinutes: 570,
    });

    const person: ScheduleComparisonOut['people'][number] = {
      actorId: ActorId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ'),
      displayName: 'Grace',
      avatar: null,
      timezone: 'Europe/London',
      items: [
        {
          access: 'busy',
          startsAt: null,
          endsAt: null,
          allDayStartDate: '2026-07-02',
          allDayEndDate: '2026-07-03',
        },
      ],
    };
    const resourceLane = buildComparisonLane(person, '2026-07-02', 'Asia/Tokyo');
    expect(resourceLane.timezone).toBe('Europe/London');
    expect(resourceLane.items[0]).toMatchObject({
      startsAt: '2026-07-01T15:00:00Z',
      endsAt: '2026-07-02T15:00:00Z',
    });
  });
});
