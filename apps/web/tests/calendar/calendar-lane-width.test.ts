import { describe, expect, it } from 'vitest';

import { calendarMinimumLaneWidth } from '@/app/(app)/calendar/calendar-lane-width';
import {
  deriveLaneGeometry,
  deriveScheduleAxis,
} from '@/components/scheduling/scheduling-geometry';

describe('Calendar responsive date lanes', () => {
  it.each([320, 390, 430, 599])('shows one day in a %d px calendar viewport', (width) => {
    const gutterWidth = deriveScheduleAxis(width).gutterWidth;
    expect(
      deriveLaneGeometry({
        viewportWidth: width,
        gutterWidth,
        laneCount: 21,
        minimumLaneWidth: calendarMinimumLaneWidth(width),
        maximumVisibleLaneCount: 7,
      }).visibleLaneCount,
    ).toBe(1);
  });

  it.each([
    [600, 2],
    [800, 3],
    [1000, 4],
    [1176, 7],
  ])('uses %d px for %d readable date lanes', (width, expected) => {
    const gutterWidth = deriveScheduleAxis(width).gutterWidth;
    expect(
      deriveLaneGeometry({
        viewportWidth: width,
        gutterWidth,
        laneCount: 21,
        minimumLaneWidth: calendarMinimumLaneWidth(width),
        maximumVisibleLaneCount: 7,
      }).visibleLaneCount,
    ).toBe(expected);
  });
});
