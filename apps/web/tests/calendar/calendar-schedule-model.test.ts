import { describe, expect, it } from 'vitest';

import { deriveRollingDateWindow } from '../../src/app/(app)/calendar/calendar-schedule-model';

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
