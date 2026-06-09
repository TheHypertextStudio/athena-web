/**
 * Unit tests for {@link formatEstimate}, the compact duration formatter the aligned task table
 * renders in its estimate column.
 *
 * @remarks
 * The estimate column must read as a tabular `Hh Mm` duration ("1h 30m", "45m", "2h") so estimates
 * line up across rows, and an unset/zero/negative estimate must collapse to `null` so the column
 * renders its neutral placeholder rather than "0m". This pins that branching independent of the
 * React tree.
 */
import { describe, expect, it } from 'vitest';

import { formatEstimate } from '../src/lib/format-estimate';

describe('formatEstimate', () => {
  it('formats a mixed hours-and-minutes estimate as "Hh Mm"', () => {
    expect(formatEstimate(90)).toBe('1h 30m');
  });

  it('formats a sub-hour estimate as minutes only', () => {
    expect(formatEstimate(45)).toBe('45m');
  });

  it('formats a whole-hour estimate as hours only', () => {
    expect(formatEstimate(120)).toBe('2h');
    expect(formatEstimate(60)).toBe('1h');
  });

  it('rounds a fractional minute count to the nearest whole minute', () => {
    expect(formatEstimate(90.4)).toBe('1h 30m');
    expect(formatEstimate(44.6)).toBe('45m');
  });

  it('returns null for an unset, zero, negative, or non-finite estimate', () => {
    expect(formatEstimate(null)).toBeNull();
    expect(formatEstimate(undefined)).toBeNull();
    expect(formatEstimate(0)).toBeNull();
    expect(formatEstimate(-30)).toBeNull();
    expect(formatEstimate(Number.NaN)).toBeNull();
    expect(formatEstimate(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
