/**
 * Unit tests for the timeline's axis model in
 * {@link import('../../../src/components/timeline/time-scale')}.
 *
 * @remarks
 * The axis is the piece the previous Projects lens got wrong in three separate ways, so each one
 * is pinned here:
 *
 * - the **viewport is exact and independent of the data**, which is what makes zoom and pan stable
 *   and stops bars from kissing the window edges;
 * - **date math is UTC**, so a date-only wire value does not shift a day for viewers west of UTC;
 * - **ticks are calendar boundaries inside the window**, not two interpolated endpoints.
 */
import { describe, expect, it } from 'vitest';

import {
  DAY_MS,
  buildScale,
  dateAtPct,
  defaultWindow,
  extentOf,
  panWindow,
  parseDate,
  pct,
  pickGranularity,
  snapDown,
  zoomWindow,
} from '@/components/timeline/time-scale';

/** A fixed "now" so every window assertion is deterministic. */
const NOW = Date.UTC(2026, 6, 25); // 2026-07-25
const utc = (y: number, m: number, d: number): number => Date.UTC(y, m - 1, d);

describe('parseDate', () => {
  it('parses a date-only wire value as UTC midnight', () => {
    expect(parseDate('2026-03-09')).toBe(utc(2026, 3, 9));
  });

  it('returns null for absent or unparseable values', () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate('not-a-date')).toBeNull();
  });
});

describe('snapDown', () => {
  it('snaps to UTC day, ISO Monday, first-of-month, and quarter start', () => {
    // 2026-03-11 is a Wednesday; the ISO week opens Monday 2026-03-09.
    const wednesday = utc(2026, 3, 11) + 13 * 3_600_000;
    expect(snapDown(wednesday, 'day')).toBe(utc(2026, 3, 11));
    expect(snapDown(wednesday, 'week')).toBe(utc(2026, 3, 9));
    expect(snapDown(wednesday, 'month')).toBe(utc(2026, 3, 1));
    expect(snapDown(wednesday, 'quarter')).toBe(utc(2026, 1, 1));
  });
});

describe('pickGranularity', () => {
  it('keeps the axis in a legible tick range across zoom levels', () => {
    expect(pickGranularity(10 * DAY_MS)).toBe('day');
    expect(pickGranularity(60 * DAY_MS)).toBe('week');
    expect(pickGranularity(300 * DAY_MS)).toBe('month');
    expect(pickGranularity(1200 * DAY_MS)).toBe('quarter');
  });
});

describe('defaultWindow', () => {
  it('always frames today, even when every dated item is in the past', () => {
    const past = { start: utc(2025, 1, 1), end: utc(2025, 2, 1) };
    const window = defaultWindow([past], NOW);
    expect(window.min).toBeLessThan(past.start);
    expect(window.max).toBeGreaterThan(NOW);
  });

  it('pads the extents so bars never sit flush against an edge', () => {
    const dated = { start: utc(2026, 7, 1), end: utc(2026, 8, 1) };
    const window = defaultWindow([dated], NOW);
    expect(window.min).toBeLessThan(dated.start);
    expect(window.max).toBeGreaterThan(dated.end);
  });

  it('falls back to a window around today rather than collapsing when nothing is dated', () => {
    const window = defaultWindow([], NOW);
    expect(window.min).toBeLessThan(NOW);
    expect(window.max).toBeGreaterThan(NOW);
  });
});

describe('extentOf', () => {
  it('returns null when nothing is dated', () => {
    expect(extentOf([])).toBeNull();
  });

  it('spans the earliest start to the latest end', () => {
    expect(
      extentOf([
        { start: 30, end: 40 },
        { start: 10, end: 20 },
      ]),
    ).toEqual({ min: 10, max: 40 });
  });
});

describe('zoomWindow', () => {
  it('holds the anchor point fixed so zooming happens under the cursor', () => {
    // Day-scale so the result stays clear of the minimum-window clamp.
    const window = { min: 0, max: 1000 * DAY_MS };
    const zoomed = zoomWindow(window, 0.5, 0.25);
    // The instant at 25% of the old window stays at 25% of the new one.
    expect(pct(250 * DAY_MS, zoomed)).toBeCloseTo(25, 4);
  });

  it('preserves the center when anchored at the midpoint', () => {
    const window = { min: 0, max: 100 * DAY_MS };
    const zoomed = zoomWindow(window, 0.5, 0.5);
    expect((zoomed.min + zoomed.max) / 2).toBeCloseTo((window.min + window.max) / 2, -3);
    expect(zoomed.max - zoomed.min).toBeLessThan(window.max - window.min);
  });

  it('clamps so repeated zoom-in cannot collapse the window', () => {
    let window = { min: 0, max: 400 * DAY_MS };
    for (let i = 0; i < 40; i++) window = zoomWindow(window, 0.5, 0.5);
    expect(window.max - window.min).toBeGreaterThanOrEqual(7 * DAY_MS - 1);
  });
});

describe('panWindow', () => {
  it('shifts the window while preserving its span', () => {
    const window = { min: 0, max: 100 };
    const panned = panWindow(window, 0.5);
    expect(panned).toEqual({ min: 50, max: 150 });
  });
});

describe('buildScale', () => {
  it('passes the viewport through unchanged — only ticks are calendar-aligned', () => {
    const window = { min: utc(2026, 3, 5) + 12_345, max: utc(2026, 6, 20) + 999 };
    const scale = buildScale(window, 'month');
    expect(scale.min).toBe(window.min);
    expect(scale.max).toBe(window.max);
  });

  it('emits only ticks that fall inside the window', () => {
    const window = { min: utc(2026, 3, 5), max: utc(2026, 6, 20) };
    const scale = buildScale(window, 'month');
    expect(scale.ticks.map((tick) => tick.at)).toEqual([
      utc(2026, 4, 1),
      utc(2026, 5, 1),
      utc(2026, 6, 1),
    ]);
    for (const tick of scale.ticks) {
      expect(tick.at).toBeGreaterThanOrEqual(window.min);
      expect(tick.at).toBeLessThanOrEqual(window.max);
    }
  });

  it('marks January as a major tick at coarse granularities', () => {
    const scale = buildScale({ min: utc(2025, 11, 1), max: utc(2026, 4, 1) }, 'month');
    const january = scale.ticks.find((tick) => tick.at === utc(2026, 1, 1));
    expect(january?.major).toBe(true);
    expect(scale.ticks.find((tick) => tick.at === utc(2026, 2, 1))?.major).toBe(false);
  });

  it('resolves auto granularity from the viewport span', () => {
    expect(buildScale({ min: 0, max: 10 * DAY_MS }, 'auto').granularity).toBe('day');
    expect(buildScale({ min: 0, max: 1200 * DAY_MS }, 'auto').granularity).toBe('quarter');
  });
});

describe('pct and dateAtPct', () => {
  it('projects an instant to a percentage of the window', () => {
    expect(pct(50, { min: 0, max: 200 })).toBe(25);
  });

  it('returns 0 for a degenerate window rather than dividing by zero', () => {
    expect(pct(5, { min: 10, max: 10 })).toBe(0);
  });

  it('round-trips a percentage back to the day containing that instant', () => {
    const window = { min: utc(2026, 3, 1), max: utc(2026, 4, 1) };
    const at = dateAtPct(pct(utc(2026, 3, 15), window), window);
    expect(at).toBe(utc(2026, 3, 15));
  });

  it('snaps to a UTC day so a drag always lands on a real calendar date', () => {
    const window = { min: utc(2026, 3, 1), max: utc(2026, 3, 31) };
    const at = dateAtPct(37.4, window);
    expect(at % DAY_MS).toBe(0);
  });
});
