import { describe, expect, it } from 'vitest';

import {
  mergeIntervals,
  overlaps,
  SpanPool,
  spanMinutes,
  subtractIntervals,
  type Span,
} from '../src/intervals';

const HOUR = 60 * 60 * 1_000;

function span(start: number, end: number, kind: Span['kind'] = 'desk'): Span {
  return { date: '2026-08-31', kind, start, end };
}

describe('planning interval algebra', () => {
  it('measures truncated minutes and half-open overlap', () => {
    expect(spanMinutes({ start: 0, end: 90_999 })).toBe(1);
    expect(overlaps({ start: 0, end: 10 }, { start: 9, end: 20 })).toBe(true);
    expect(overlaps({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(false);
  });

  it('merges touching and overlapping intervals while dropping empty input', () => {
    expect(
      mergeIntervals([
        { start: 20, end: 30 },
        { start: 0, end: 10 },
        { start: 8, end: 20 },
        { start: 5, end: 5 },
        { start: 40, end: 39 },
      ]),
    ).toEqual([{ start: 0, end: 30 }]);
  });

  it('keeps the widest interval when another interval is fully contained', () => {
    expect(
      mergeIntervals([
        { start: 0, end: 30 },
        { start: 5, end: 20 },
      ]),
    ).toEqual([{ start: 0, end: 30 }]);
  });

  it('subtracts blockers before, within, across, and after spans', () => {
    expect(
      subtractIntervals(
        [span(0, 100), span(200, 300)],
        [
          { start: -20, end: 10 },
          { start: 30, end: 50 },
          { start: 90, end: 220 },
          { start: 260, end: 400 },
        ],
      ),
    ).toEqual([span(10, 30), span(50, 90), span(220, 260)]);
  });

  it('returns sorted spans unchanged when blockers miss them', () => {
    expect(subtractIntervals([span(200, 300), span(0, 100)], [{ start: 100, end: 150 }])).toEqual([
      span(0, 100),
      span(200, 300),
    ]);
  });
});

describe('SpanPool', () => {
  it('sorts valid spans and reports remaining minutes by kind', () => {
    const pool = new SpanPool([span(HOUR, 2 * HOUR, 'field'), span(0, HOUR), span(3, 2)]);
    expect(pool.spans).toEqual([span(0, HOUR), span(HOUR, 2 * HOUR, 'field')]);
    expect(pool.remainingMinutes()).toBe(120);
    expect(pool.remainingMinutes('desk')).toBe(60);
    expect(pool.remainingMinutes('field')).toBe(60);
  });

  it('takes the first matching run after all selectors', () => {
    const otherDate = { ...span(0, 4 * HOUR), date: '2026-09-01' };
    const pool = new SpanPool([span(0, 4 * HOUR, 'field'), otherDate, span(4 * HOUR, 8 * HOUR)]);
    expect(
      pool.take(60, {
        kind: 'desk',
        date: '2026-08-31',
        excludeDates: new Set(['2026-09-01']),
        notBefore: 5 * HOUR,
      }),
    ).toEqual(span(5 * HOUR, 6 * HOUR));
  });

  it('leaves the pool unchanged when selectors reject every span', () => {
    const pool = new SpanPool([span(0, HOUR)]);
    expect(pool.take(60, { date: '2026-09-01' })).toBeNull();
    expect(pool.take(60, { excludeDates: new Set(['2026-08-31']) })).toBeNull();
    expect(pool.take(60, { notBefore: HOUR })).toBeNull();
    expect(pool.spans).toEqual([span(0, HOUR)]);
  });

  it('reserves a trailing buffer without returning it as part of the block', () => {
    const pool = new SpanPool([span(0, 3 * HOUR)]);
    expect(pool.take(60, { reserveAfterMinutes: 30, requireTrailingMinutes: 60 })).toEqual(
      span(0, HOUR),
    );
    expect(pool.spans).toEqual([span(1.5 * HOUR, 3 * HOUR)]);
  });

  it('rejects a placement when its required trailing run does not fit', () => {
    const pool = new SpanPool([span(0, 2 * HOUR)]);
    expect(pool.take(60, { reserveAfterMinutes: 30, requireTrailingMinutes: 60 })).toBeNull();
    expect(pool.spans).toEqual([span(0, 2 * HOUR)]);
  });

  it('allows a reserve to stop at the end of its containing span', () => {
    const pool = new SpanPool([span(0, 75 * 60_000)]);
    expect(pool.take(60, { reserveAfterMinutes: 30 })).toEqual(span(0, HOUR));
    expect(pool.spans).toEqual([]);
  });

  it('takes an exact free interval and retains both remainders', () => {
    const pool = new SpanPool([span(0, 4 * HOUR)]);
    expect(pool.takeAt(HOUR, 60)).toEqual(span(HOUR, 2 * HOUR));
    expect(pool.spans).toEqual([span(0, HOUR), span(2 * HOUR, 4 * HOUR)]);
    expect(pool.takeAt(0, 180)).toBeNull();
  });

  it('takes the longest eligible span up to the requested cap', () => {
    const pool = new SpanPool([
      span(0, HOUR, 'field'),
      span(2 * HOUR, 6 * HOUR),
      span(7 * HOUR, 9 * HOUR),
    ]);
    expect(pool.takeLongest(90, 30, { kind: 'desk' })).toEqual(span(2 * HOUR, 3.5 * HOUR));
    expect(pool.takeLongest(60, 500)).toBeNull();
    expect(pool.takeLongest(60, 30, { kind: 'transit' })).toBeNull();
  });
});
