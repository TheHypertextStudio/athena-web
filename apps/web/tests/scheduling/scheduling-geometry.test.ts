import { describe, expect, it } from 'vitest';

import {
  dateKeyForInstant,
  deriveLaneGeometry,
  deriveSnapMinutes,
  findDateLane,
  itemBoundsInLane,
  laneIndexAtOffset,
  minutesToPixels,
  pixelDeltaToMinutes,
  pixelsToMinutes,
  type ScheduleItem,
  type ScheduleLane,
} from '@/components/scheduling';

const ITEM: ScheduleItem = {
  id: 'focus',
  title: 'Focus',
  startsAt: '2026-07-01T23:30:00.000Z',
  endsAt: '2026-07-02T00:30:00.000Z',
};

/** Build an empty date lane for pure helper tests. */
function lane(id: string, date: string, timezone = 'UTC'): ScheduleLane {
  return { id, label: id, date, timezone, items: [] };
}

describe('fluid scheduling geometry', () => {
  it('derives lane width and visible count from viewport width and arbitrary lane count', () => {
    expect(
      deriveLaneGeometry({
        viewportWidth: 1_000,
        gutterWidth: 64,
        minimumLaneWidth: 220,
        laneCount: 10,
      }),
    ).toEqual({
      gutterWidth: 64,
      laneWidth: 234,
      visibleLaneCount: 4,
      contentWidth: 2_340,
    });

    expect(
      deriveLaneGeometry({
        viewportWidth: 1_000,
        gutterWidth: 64,
        minimumLaneWidth: 220,
        laneCount: 3,
      }),
    ).toEqual({
      gutterWidth: 64,
      laneWidth: 312,
      visibleLaneCount: 3,
      contentWidth: 936,
    });
  });

  it('preserves full grid width when there are no lanes', () => {
    expect(deriveLaneGeometry({ viewportWidth: 800, gutterWidth: 64, laneCount: 0 })).toEqual({
      gutterWidth: 64,
      laneWidth: 736,
      visibleLaneCount: 0,
      contentWidth: 736,
    });
  });

  it('derives progressively finer snapping from continuous zoom down to five minutes', () => {
    expect(deriveSnapMinutes(30)).toBe(30);
    expect(deriveSnapMinutes(60)).toBe(10);
    expect(deriveSnapMinutes(120)).toBe(5);
    expect(deriveSnapMinutes(73.5)).toBe(10);
  });

  it('converts pixels, minutes, signed deltas, and lane offsets consistently', () => {
    expect(minutesToPixels(90, 80)).toBe(120);
    expect(pixelsToMinutes(121, 80, 5)).toBe(90);
    expect(pixelDeltaToMinutes(-39, 60, 5)).toBe(-40);
    expect(laneIndexAtOffset(0, 4, 200)).toBe(0);
    expect(laneIndexAtOffset(450, 4, 200)).toBe(2);
    expect(laneIndexAtOffset(999, 4, 200)).toBe(3);
    expect(laneIndexAtOffset(0, 0, 200)).toBeNull();
  });
});

describe('schedule date lanes', () => {
  it('maps instants to date lanes using each lane timezone', () => {
    const lanes = [lane('utc-july-1', '2026-07-01'), lane('utc-july-2', '2026-07-02')];
    expect(dateKeyForInstant(ITEM.startsAt, 'UTC')).toBe('2026-07-01');
    expect(findDateLane(lanes, ITEM.startsAt)?.id).toBe('utc-july-1');

    const losAngeles = lane('la-july-1', '2026-07-01', 'America/Los_Angeles');
    expect(findDateLane([losAngeles], ITEM.endsAt)?.id).toBe('la-july-1');
  });

  it('clips multi-day items to a lane and ignores all-day or out-of-date items', () => {
    expect(itemBoundsInLane(ITEM, lane('july-1', '2026-07-01'))).toEqual({
      startMinutes: 23 * 60 + 30,
      endMinutes: 24 * 60,
    });
    expect(itemBoundsInLane(ITEM, lane('july-2', '2026-07-02'))).toEqual({
      startMinutes: 0,
      endMinutes: 30,
    });
    expect(itemBoundsInLane({ ...ITEM, allDay: true }, lane('july-1', '2026-07-01'))).toBeNull();
    expect(itemBoundsInLane(ITEM, lane('july-3', '2026-07-03'))).toBeNull();
  });

  it('treats invalid instants and timezones as non-placeable input', () => {
    expect(dateKeyForInstant('not-a-date', 'UTC')).toBeNull();
    expect(dateKeyForInstant(ITEM.startsAt, 'Not/A_Timezone')).toBeNull();
    expect(
      itemBoundsInLane({ ...ITEM, startsAt: 'invalid' }, lane('july-1', '2026-07-01')),
    ).toBeNull();
  });

  it('uses the canvas timezone and preserves duration through a repeated wall time', () => {
    const repeatedHourItem: ScheduleItem = {
      id: 'repeated-hour',
      title: 'Repeated hour',
      startsAt: '2026-11-01T08:30:00Z',
      endsAt: '2026-11-01T09:30:00Z',
    };

    expect(
      itemBoundsInLane(
        repeatedHourItem,
        lane('fall-back', '2026-11-01', 'UTC'),
        'America/Los_Angeles',
      ),
    ).toEqual({ startMinutes: 90, endMinutes: 150 });
  });
});
