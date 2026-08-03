/**
 * `tests/timeline` — the five zoom granularities.
 *
 * @remarks
 * "Days, weeks, months, quarters, years" is a list of five things a plan is discussed in, and the
 * timeline offered four of them with the fifth missing entirely. Restoring it is only half the
 * requirement: a granularity that relabels the axis without changing the window is not a zoom, so
 * these assertions check both halves — that each unit labels the scale in its own terms, and that
 * asking for it re-frames the viewport to a width where its ticks are actually legible.
 */
import { describe, expect, it } from 'vitest';

import {
  DAY_MS,
  SCALE_LABEL,
  buildScale,
  pickGranularity,
  windowForGranularity,
  type ResolvedGranularity,
  type TimeWindow,
} from '@/components/timeline/time-scale';
import type { ViewScale } from '@/components/views/field-catalog';
import { parseViewDisplay, serializeViewDisplay } from '@/components/views/view-state-url';
import { DEFAULT_VIEW_DISPLAY } from '@/components/views/field-catalog';

/** The five concrete units, in the order the menu offers them. */
const UNITS: readonly ResolvedGranularity[] = ['day', 'week', 'month', 'quarter', 'year'];
/** A window centred on 2026-03-01, one year wide. */
const BASE: TimeWindow = { min: Date.UTC(2026, 0, 1), max: Date.UTC(2027, 0, 1) };

describe('five granularities, each a real zoom', () => {
  it('offers a human label for every unit, including years', () => {
    for (const unit of UNITS) expect(SCALE_LABEL[unit]).toBeTruthy();
    expect(SCALE_LABEL.year).toBe('Years');
    expect(Object.keys(SCALE_LABEL)).toHaveLength(6);
  });

  it('relabels the axis in each unit’s own terms', () => {
    const labels = new Map<ResolvedGranularity, string>();
    for (const unit of UNITS) {
      const scale = buildScale(windowForGranularity(BASE, unit), unit);
      expect(scale.granularity).toBe(unit);
      expect(scale.ticks.length).toBeGreaterThan(1);
      labels.set(unit, scale.ticks[1]?.label ?? '');
    }
    // Each unit produces a distinct vocabulary: a day/week label carries a day number, a month
    // label a month name, a quarter label a Q, a year label four digits.
    expect(labels.get('month')).toMatch(/^[A-Za-z]+$/);
    expect(labels.get('quarter')).toMatch(/^Q[1-4] '\d\d$/);
    expect(labels.get('year')).toMatch(/^\d{4}$/);
    expect(new Set(labels.values()).size).toBeGreaterThanOrEqual(4);
  });

  it('re-frames the window so each unit renders a legible number of ticks', () => {
    let previous = 0;
    for (const unit of UNITS) {
      const framed = windowForGranularity(BASE, unit);
      const span = framed.max - framed.min;
      // Coarser units show more time.
      expect(span).toBeGreaterThan(previous);
      previous = span;
      // …and never so many marks that the header becomes a comb.
      const scale = buildScale(framed, unit);
      expect(scale.ticks.length).toBeGreaterThanOrEqual(4);
      expect(scale.ticks.length).toBeLessThanOrEqual(20);
      // The centre of the plan is held while zooming.
      expect((framed.min + framed.max) / 2).toBeCloseTo((BASE.min + BASE.max) / 2, -3);
    }
  });

  it('leaves the window exactly where it is for `auto`', () => {
    expect(windowForGranularity(BASE, 'auto')).toEqual(BASE);
  });

  it('picks years automatically once the window is wider than a few quarters', () => {
    expect(pickGranularity(10 * DAY_MS)).toBe('day');
    expect(pickGranularity(60 * DAY_MS)).toBe('week');
    expect(pickGranularity(300 * DAY_MS)).toBe('month');
    expect(pickGranularity(1500 * DAY_MS)).toBe('quarter');
    expect(pickGranularity(4000 * DAY_MS)).toBe('year');
  });
});

describe('the chosen granularity survives a reload', () => {
  it('round-trips through the URL for every unit', () => {
    for (const unit of [...UNITS, 'auto'] as readonly ViewScale[]) {
      const params = new URLSearchParams();
      serializeViewDisplay({ ...DEFAULT_VIEW_DISPLAY, scale: unit }, params);
      expect(parseViewDisplay(new URLSearchParams(params.toString())).scale).toBe(unit);
    }
  });

  it('falls back to the default rather than blanking the axis on a hand-edited URL', () => {
    const params = new URLSearchParams('display=scale:decades');
    expect(parseViewDisplay(params).scale).toBe(DEFAULT_VIEW_DISPLAY.scale);
  });
});
