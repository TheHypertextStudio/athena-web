import { describe, expect, it } from 'vitest';

import { layoutScheduleOverlaps, type ScheduleOverlapInput } from '@/components/scheduling';
import { scheduleOverlapHorizontalStyle } from '@/components/scheduling/scheduling-overlap-layout';

const STANDARD_PIXELS_PER_HOUR = 60;
const MINIMUM_INTERACTIVE_PIXELS = 18;

/** Build one already-clipped scheduling interval. */
function interval(id: string, startMinutes: number, endMinutes: number): ScheduleOverlapInput {
  return { id, startMinutes, endMinutes };
}

describe('layoutScheduleOverlaps', () => {
  it('returns no placements for an empty lane', () => {
    expect(
      layoutScheduleOverlaps([], STANDARD_PIXELS_PER_HOUR, MINIMUM_INTERACTIVE_PIXELS),
    ).toEqual([]);
  });

  it('gives disjoint intervals independent full-width columns', () => {
    expect(
      layoutScheduleOverlaps(
        [interval('a', 9 * 60, 9 * 60 + 30), interval('b', 10 * 60, 10 * 60 + 30)],
        STANDARD_PIXELS_PER_HOUR,
        MINIMUM_INTERACTIVE_PIXELS,
      ),
    ).toEqual([
      { id: 'a', columnIndex: 0, columnCount: 1 },
      { id: 'b', columnIndex: 0, columnCount: 1 },
    ]);
  });

  it('does not collide intervals whose true visual bounds exactly touch', () => {
    expect(
      layoutScheduleOverlaps(
        [interval('a', 9 * 60, 10 * 60), interval('b', 10 * 60, 11 * 60)],
        STANDARD_PIXELS_PER_HOUR,
        MINIMUM_INTERACTIVE_PIXELS,
      ),
    ).toEqual([
      { id: 'a', columnIndex: 0, columnCount: 1 },
      { id: 'b', columnIndex: 0, columnCount: 1 },
    ]);
  });

  it('places a partially overlapping pair in separate columns', () => {
    expect(
      layoutScheduleOverlaps(
        [interval('a', 9 * 60, 10 * 60), interval('b', 9 * 60 + 30, 10 * 60 + 30)],
        STANDARD_PIXELS_PER_HOUR,
        MINIMUM_INTERACTIVE_PIXELS,
      ),
    ).toEqual([
      { id: 'a', columnIndex: 0, columnCount: 2 },
      { id: 'b', columnIndex: 1, columnCount: 2 },
    ]);
  });

  it('places a nested triple in three columns', () => {
    expect(
      layoutScheduleOverlaps(
        [
          interval('a', 9 * 60, 11 * 60),
          interval('b', 9 * 60 + 15, 10 * 60 + 45),
          interval('c', 9 * 60 + 30, 10 * 60),
        ],
        STANDARD_PIXELS_PER_HOUR,
        MINIMUM_INTERACTIVE_PIXELS,
      ),
    ).toEqual([
      { id: 'a', columnIndex: 0, columnCount: 3 },
      { id: 'b', columnIndex: 1, columnCount: 3 },
      { id: 'c', columnIndex: 2, columnCount: 3 },
    ]);
  });

  it('uses stable id order for three intervals with identical bounds', () => {
    expect(
      layoutScheduleOverlaps(
        [
          interval('zeta', 9 * 60, 10 * 60),
          interval('alpha', 9 * 60, 10 * 60),
          interval('middle', 9 * 60, 10 * 60),
        ],
        STANDARD_PIXELS_PER_HOUR,
        MINIMUM_INTERACTIVE_PIXELS,
      ),
    ).toEqual([
      { id: 'alpha', columnIndex: 0, columnCount: 3 },
      { id: 'middle', columnIndex: 1, columnCount: 3 },
      { id: 'zeta', columnIndex: 2, columnCount: 3 },
    ]);
  });

  it('produces identical ordered placements for reversed and permuted input', () => {
    const inputs = [
      interval('a', 9 * 60, 11 * 60),
      interval('b', 9 * 60 + 15, 10 * 60),
      interval('c', 10 * 60 + 30, 11 * 60 + 30),
      interval('d', 12 * 60, 13 * 60),
    ];
    const expected = layoutScheduleOverlaps(
      inputs,
      STANDARD_PIXELS_PER_HOUR,
      MINIMUM_INTERACTIVE_PIXELS,
    );

    expect(
      layoutScheduleOverlaps(
        [...inputs].reverse(),
        STANDARD_PIXELS_PER_HOUR,
        MINIMUM_INTERACTIVE_PIXELS,
      ),
    ).toEqual(expected);
    expect(
      layoutScheduleOverlaps(
        [inputs[2]!, inputs[0]!, inputs[3]!, inputs[1]!],
        STANDARD_PIXELS_PER_HOUR,
        MINIMUM_INTERACTIVE_PIXELS,
      ),
    ).toEqual(expected);
  });

  it('reuses the lowest free column inside a transitive overlap chain', () => {
    expect(
      layoutScheduleOverlaps(
        [
          interval('a', 9 * 60, 10 * 60),
          interval('b', 9 * 60 + 30, 10 * 60 + 30),
          interval('c', 10 * 60 + 15, 11 * 60),
        ],
        STANDARD_PIXELS_PER_HOUR,
        MINIMUM_INTERACTIVE_PIXELS,
      ),
    ).toEqual([
      { id: 'a', columnIndex: 0, columnCount: 2 },
      { id: 'b', columnIndex: 1, columnCount: 2 },
      { id: 'c', columnIndex: 0, columnCount: 2 },
    ]);
  });

  it('keeps disjoint clusters from inflating one another', () => {
    expect(
      layoutScheduleOverlaps(
        [
          interval('a', 9 * 60, 10 * 60),
          interval('b', 9 * 60, 10 * 60),
          interval('c', 12 * 60, 12 * 60 + 30),
        ],
        STANDARD_PIXELS_PER_HOUR,
        MINIMUM_INTERACTIVE_PIXELS,
      ),
    ).toEqual([
      { id: 'a', columnIndex: 0, columnCount: 2 },
      { id: 'b', columnIndex: 1, columnCount: 2 },
      { id: 'c', columnIndex: 0, columnCount: 1 },
    ]);
  });

  it('treats the 18px minimum rendered height as a collision at low zoom', () => {
    expect(
      layoutScheduleOverlaps(
        [interval('a', 9 * 60, 9 * 60 + 5), interval('b', 9 * 60 + 10, 9 * 60 + 15)],
        STANDARD_PIXELS_PER_HOUR,
        MINIMUM_INTERACTIVE_PIXELS,
      ),
    ).toEqual([
      { id: 'a', columnIndex: 0, columnCount: 2 },
      { id: 'b', columnIndex: 1, columnCount: 2 },
    ]);
  });

  it('keeps the same short intervals disjoint when high zoom makes their true gap visible', () => {
    expect(
      layoutScheduleOverlaps(
        [interval('a', 9 * 60, 9 * 60 + 5), interval('b', 9 * 60 + 10, 9 * 60 + 15)],
        240,
        MINIMUM_INTERACTIVE_PIXELS,
      ),
    ).toEqual([
      { id: 'a', columnIndex: 0, columnCount: 1 },
      { id: 'b', columnIndex: 0, columnCount: 1 },
    ]);
  });
});

describe('scheduleOverlapHorizontalStyle', () => {
  it('leaves exact four-pixel outer and internal gutters for two and three columns', () => {
    expect(
      [0, 1].map((columnIndex) =>
        scheduleOverlapHorizontalStyle({
          id: `two-${String(columnIndex)}`,
          columnIndex,
          columnCount: 2,
        }),
      ),
    ).toEqual([
      { left: 4, width: 'calc(50% - 6px)' },
      { left: 'calc(50% + 2px)', width: 'calc(50% - 6px)' },
    ]);
    expect(
      [0, 1, 2].map((columnIndex) =>
        scheduleOverlapHorizontalStyle({
          id: `three-${String(columnIndex)}`,
          columnIndex,
          columnCount: 3,
        }),
      ),
    ).toEqual([
      { left: 4, width: 'calc(33.333333% - 5.333333px)' },
      { left: 'calc(33.333333% + 2.666667px)', width: 'calc(33.333333% - 5.333333px)' },
      { left: 'calc(66.666667% + 1.333333px)', width: 'calc(33.333333% - 5.333333px)' },
    ]);
  });
});
