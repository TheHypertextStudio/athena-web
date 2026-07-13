import { describe, expect, it } from 'vitest';

import {
  deriveAllDayGesturePreview,
  scheduleAllDayEditCapabilities,
  scheduleAllDayRange,
} from '@/components/scheduling/scheduling-all-day-editing';
import type { ScheduleItem, ScheduleLane } from '@/components/scheduling/scheduling-types';

const DST_RANGE: ScheduleItem = {
  id: 'dst-offsite',
  title: 'DST offsite',
  startsAt: '2026-03-07T08:00:00Z',
  endsAt: '2026-03-10T07:00:00Z',
  allDay: true,
};

function lane(date: string): ScheduleLane {
  return { id: `date:${date}`, label: date, date, items: [DST_RANGE] };
}

describe('all-day calendar-date editing', () => {
  it('preserves calendar-day duration across a spring-forward transition', () => {
    const range = scheduleAllDayRange(DST_RANGE, 'America/Los_Angeles');

    expect(range).toEqual({
      startDate: '2026-03-07',
      endDate: '2026-03-10',
      durationDays: 3,
    });
    expect(
      range &&
        deriveAllDayGesturePreview({
          mode: 'move',
          range,
          targetLane: lane('2026-03-08'),
          targetLaneIndex: 1,
        }),
    ).toEqual({
      laneIndex: 1,
      startDate: '2026-03-08',
      endDate: '2026-03-11',
    });
  });

  it('assigns controls only to the true first and final covered dates', () => {
    expect(
      scheduleAllDayEditCapabilities(DST_RANGE, lane('2026-03-07'), 'America/Los_Angeles'),
    ).toEqual({ canMove: true, canResizeStart: true, canResizeEnd: false });
    expect(
      scheduleAllDayEditCapabilities(DST_RANGE, lane('2026-03-08'), 'America/Los_Angeles'),
    ).toEqual({ canMove: false, canResizeStart: false, canResizeEnd: false });
    expect(
      scheduleAllDayEditCapabilities(DST_RANGE, lane('2026-03-09'), 'America/Los_Angeles'),
    ).toEqual({ canMove: false, canResizeStart: false, canResizeEnd: true });
  });

  it('rejects a resize that would invert the inclusive-start/exclusive-end range', () => {
    const range = scheduleAllDayRange(DST_RANGE, 'America/Los_Angeles');

    expect(
      range &&
        deriveAllDayGesturePreview({
          mode: 'resize-start',
          range,
          targetLane: lane('2026-03-10'),
          targetLaneIndex: 3,
        }),
    ).toBeNull();
  });
});
