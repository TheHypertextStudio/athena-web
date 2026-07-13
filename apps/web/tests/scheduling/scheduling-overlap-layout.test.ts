import { describe, expect, it } from 'vitest';

import { layoutScheduleOverlaps, type ScheduleOverlapInput } from '@/components/scheduling';
import {
  positionScheduleLaneItems,
  scheduleOverlapHorizontalStyle,
} from '@/components/scheduling/scheduling-overlap-layout';
import { quadraticOverlapLayoutOracle } from './scheduling-overlap-layout-oracle';

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

  it('keeps exact-instant overlaps separate when DST display geometry is disjoint', () => {
    expect(
      layoutScheduleOverlaps(
        [
          {
            ...interval('spring-crossing', 90, 150),
            exactStartMinutes: 100,
            exactEndMinutes: 160,
          },
          {
            ...interval('after-gap', 180, 240),
            exactStartMinutes: 130,
            exactEndMinutes: 190,
          },
        ],
        STANDARD_PIXELS_PER_HOUR,
        MINIMUM_INTERACTIVE_PIXELS,
      ),
    ).toEqual([
      { id: 'spring-crossing', columnIndex: 0, columnCount: 2 },
      { id: 'after-gap', columnIndex: 1, columnCount: 2 },
    ]);
  });

  it('uses a third column when an exact-only edge closes a visual overlap triangle', () => {
    const inputs = [
      {
        ...interval('a', 540, 600),
        exactStartMinutes: 100,
        exactEndMinutes: 160,
      },
      {
        ...interval('b', 570, 630),
        exactStartMinutes: 200,
        exactEndMinutes: 260,
      },
      {
        ...interval('c', 600, 660),
        exactStartMinutes: 130,
        exactEndMinutes: 190,
      },
    ];
    const expected = [
      { id: 'a', columnIndex: 0, columnCount: 3 },
      { id: 'b', columnIndex: 1, columnCount: 3 },
      { id: 'c', columnIndex: 2, columnCount: 3 },
    ];

    expect(
      layoutScheduleOverlaps(inputs, STANDARD_PIXELS_PER_HOUR, MINIMUM_INTERACTIVE_PIXELS),
    ).toEqual(expected);
    expect(
      layoutScheduleOverlaps(
        [...inputs].reverse(),
        STANDARD_PIXELS_PER_HOUR,
        MINIMUM_INTERACTIVE_PIXELS,
      ),
    ).toEqual(expected);
  });

  it('uses the minimum two columns for an exact-only four-item path', () => {
    const inputs = [
      {
        ...interval('e', 0, 1),
        exactStartMinutes: 0,
        exactEndMinutes: 2,
      },
      {
        ...interval('h', 10, 11),
        exactStartMinutes: 5,
        exactEndMinutes: 7,
      },
      {
        ...interval('b', 20, 21),
        exactStartMinutes: 1,
        exactEndMinutes: 4,
      },
      {
        ...interval('a', 30, 31),
        exactStartMinutes: 3,
        exactEndMinutes: 6,
      },
    ];
    const expected = [
      { id: 'e', columnIndex: 0, columnCount: 2 },
      { id: 'h', columnIndex: 1, columnCount: 2 },
      { id: 'b', columnIndex: 1, columnCount: 2 },
      { id: 'a', columnIndex: 0, columnCount: 2 },
    ];

    expect(layoutScheduleOverlaps(inputs, STANDARD_PIXELS_PER_HOUR, 0)).toEqual(expected);
    expect(layoutScheduleOverlaps([...inputs].reverse(), STANDARD_PIXELS_PER_HOUR, 0)).toEqual(
      expected,
    );
  });

  it('totally orders equal wall starts when only some items have exact bounds', () => {
    const inputs = [
      {
        ...interval('exact-early', 90, 100),
        exactStartMinutes: 100,
        exactEndMinutes: 110,
      },
      interval('wall-only', 90, 110),
      {
        ...interval('exact-late', 90, 120),
        exactStartMinutes: 200,
        exactEndMinutes: 230,
      },
    ];
    const expected = [
      { id: 'exact-early', columnIndex: 0, columnCount: 3 },
      { id: 'exact-late', columnIndex: 1, columnCount: 3 },
      { id: 'wall-only', columnIndex: 2, columnCount: 3 },
    ];

    expect(layoutScheduleOverlaps(inputs, STANDARD_PIXELS_PER_HOUR, 0)).toEqual(expected);
    expect(layoutScheduleOverlaps([...inputs].reverse(), STANDARD_PIXELS_PER_HOUR, 0)).toEqual(
      expected,
    );
    expect(
      layoutScheduleOverlaps([inputs[1]!, inputs[2]!, inputs[0]!], STANDARD_PIXELS_PER_HOUR, 0),
    ).toEqual(expected);
  });

  it('keeps repeated-wall-time cards separate even when exact instants do not overlap', () => {
    expect(
      layoutScheduleOverlaps(
        [
          {
            ...interval('first-occurrence', 90, 120),
            exactStartMinutes: 100,
            exactEndMinutes: 130,
          },
          {
            ...interval('second-occurrence', 90, 120),
            exactStartMinutes: 160,
            exactEndMinutes: 190,
          },
        ],
        STANDARD_PIXELS_PER_HOUR,
        MINIMUM_INTERACTIVE_PIXELS,
      ),
    ).toEqual([
      { id: 'first-occurrence', columnIndex: 0, columnCount: 2 },
      { id: 'second-occurrence', columnIndex: 1, columnCount: 2 },
    ]);
  });

  it('orders repeated wall times by exact start before stable id', () => {
    expect(
      layoutScheduleOverlaps(
        [
          {
            ...interval('alpha-second-fold', 90, 120),
            exactStartMinutes: 160,
            exactEndMinutes: 190,
          },
          {
            ...interval('zeta-first-fold', 90, 120),
            exactStartMinutes: 100,
            exactEndMinutes: 130,
          },
        ],
        STANDARD_PIXELS_PER_HOUR,
        MINIMUM_INTERACTIVE_PIXELS,
      ),
    ).toEqual([
      { id: 'zeta-first-fold', columnIndex: 0, columnCount: 2 },
      { id: 'alpha-second-fold', columnIndex: 1, columnCount: 2 },
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

  it('assigns distinct deterministic columns to a dense fifty-item collision', () => {
    const placements = layoutScheduleOverlaps(
      Array.from({ length: 50 }, (_, index) =>
        interval(`collision-${String(index).padStart(2, '0')}`, 9 * 60, 10 * 60),
      ),
      STANDARD_PIXELS_PER_HOUR,
      MINIMUM_INTERACTIVE_PIXELS,
    );

    expect(placements).toHaveLength(50);
    expect(new Set(placements.map(({ columnIndex }) => columnIndex)).size).toBe(50);
    expect(placements.every(({ columnCount }) => columnCount === 50)).toBe(true);
  });

  it('matches the quadratic reference across deterministic mixed overlap graphs', () => {
    let state = 0x5eed1234;
    const random = (): number => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 0x1_0000_0000;
    };

    for (let sample = 0; sample < 120; sample += 1) {
      const inputs = Array.from({ length: 1 + Math.floor(random() * 18) }, (_, index) => {
        const startMinutes = Math.floor(random() * 300);
        const endMinutes = startMinutes + 1 + Math.floor(random() * 90);
        const includeExactBounds = random() > 0.2;
        const exactShift = Math.floor(random() * 241) - 120;
        const exactDurationAdjustment = Math.floor(random() * 121) - 60;
        return {
          id: `sample-${String(sample)}-item-${String(index).padStart(2, '0')}`,
          startMinutes,
          endMinutes,
          ...(includeExactBounds
            ? {
                exactStartMinutes: startMinutes + exactShift,
                exactEndMinutes: Math.max(
                  startMinutes + exactShift + 1,
                  endMinutes + exactShift + exactDurationAdjustment,
                ),
              }
            : {}),
        };
      }).sort(() => random() - 0.5);
      const pixelsPerHour = 30 + Math.floor(random() * 211);
      const minimumInteractivePixels = Math.floor(random() * 41);

      const expected = quadraticOverlapLayoutOracle(
        inputs,
        pixelsPerHour,
        minimumInteractivePixels,
      );
      expect(layoutScheduleOverlaps(inputs, pixelsPerHour, minimumInteractivePixels)).toEqual(
        expected,
      );
      expect(
        layoutScheduleOverlaps([...inputs].reverse(), pixelsPerHour, minimumInteractivePixels),
      ).toEqual(expected);
    }
  });

  it('keeps thousands of aligned disjoint intervals in independent full-width clusters', () => {
    const placements = layoutScheduleOverlaps(
      Array.from({ length: 4_000 }, (_, index) => ({
        ...interval(`disjoint-${String(index).padStart(4, '0')}`, index * 2, index * 2 + 1),
        exactStartMinutes: 50_000 + index * 2,
        exactEndMinutes: 50_000 + index * 2 + 1,
      })),
      STANDARD_PIXELS_PER_HOUR,
      0,
    );

    expect(placements).toHaveLength(4_000);
    expect(
      placements.every(({ columnIndex, columnCount }) => columnIndex === 0 && columnCount === 1),
    ).toBe(true);
  });

  it('assigns stable columns to thousands of identical aligned intervals', () => {
    const placements = layoutScheduleOverlaps(
      Array.from({ length: 4_000 }, (_, index) => ({
        ...interval(`identical-${String(index).padStart(4, '0')}`, 540, 600),
        exactStartMinutes: 50_540,
        exactEndMinutes: 50_600,
      })),
      STANDARD_PIXELS_PER_HOUR,
      MINIMUM_INTERACTIVE_PIXELS,
    );

    expect(placements).toHaveLength(4_000);
    expect(new Set(placements.map(({ columnIndex }) => columnIndex)).size).toBe(4_000);
    expect(placements.every(({ columnCount }) => columnCount === 4_000)).toBe(true);
  });

  it('keeps one exact-only pair local inside a ten-thousand-item disjoint lane', () => {
    const placements = layoutScheduleOverlaps(
      Array.from({ length: 10_000 }, (_, index) => {
        const startMinutes = index * 2;
        const exactStartMinutes = index < 2 ? 75_000 : 75_000 + startMinutes;
        return {
          ...interval(
            `mostly-disjoint-${String(index).padStart(5, '0')}`,
            startMinutes,
            startMinutes + 1,
          ),
          exactStartMinutes,
          exactEndMinutes: exactStartMinutes + 1,
        };
      }),
      STANDARD_PIXELS_PER_HOUR,
      0,
    );

    expect(placements).toHaveLength(10_000);
    expect(placements.slice(0, 2)).toEqual([
      { id: 'mostly-disjoint-00000', columnIndex: 0, columnCount: 2 },
      { id: 'mostly-disjoint-00001', columnIndex: 1, columnCount: 2 },
    ]);
    expect(
      placements
        .slice(2)
        .every(({ columnIndex, columnCount }) => columnIndex === 0 && columnCount === 1),
    ).toBe(true);
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

describe('positionScheduleLaneItems', () => {
  it('carries exact instants into spring-forward collision placement', () => {
    const positioned = positionScheduleLaneItems(
      {
        id: 'spring',
        label: 'Sun, Mar 8',
        date: '2026-03-08',
        items: [
          {
            id: 'crossing-gap',
            title: 'Crossing gap',
            startsAt: '2026-03-08T09:30:00Z',
            endsAt: '2026-03-08T10:30:00Z',
          },
          {
            id: 'after-gap',
            title: 'After gap',
            startsAt: '2026-03-08T10:00:00Z',
            endsAt: '2026-03-08T11:00:00Z',
          },
        ],
      },
      'America/Los_Angeles',
      STANDARD_PIXELS_PER_HOUR,
      MINIMUM_INTERACTIVE_PIXELS,
    );

    expect(positioned.map(({ item, placement }) => [item.id, placement.columnCount])).toEqual([
      ['crossing-gap', 2],
      ['after-gap', 2],
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
