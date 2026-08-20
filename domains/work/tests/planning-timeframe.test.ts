import { describe, expect, it } from 'vitest';

import {
  DateResolution,
  isCanonicalTimeframeAnchor,
  timeframeAnchor,
  timeframeBounds,
  timeframeKey,
  timeframeLabel,
} from '../src/planning-timeframe';

describe('planning timeframes', () => {
  it('uses the Linear date-resolution values', () => {
    expect(DateResolution.options).toEqual(['month', 'quarter', 'halfYear', 'year']);
  });

  it('resolves a calendar quarter to both canonical anchors', () => {
    expect(timeframeBounds('2026-05-19', 'quarter', 0)).toEqual({
      start: '2026-04-01',
      end: '2026-06-30',
    });
    expect(timeframeAnchor('2026-05-19', 'quarter', 0, 'start')).toBe('2026-04-01');
    expect(timeframeAnchor('2026-05-19', 'quarter', 0, 'target')).toBe('2026-06-30');
  });

  it('keeps a July fiscal year stable in its label and key', () => {
    expect(timeframeBounds('2026-11-03', 'year', 6)).toEqual({
      start: '2026-07-01',
      end: '2027-06-30',
    });
    expect(timeframeLabel('2027-06-30', 'year', 6)).toBe('FY 2027');
    expect(timeframeKey('2027-06-30', 'year', 6)).toBe('2027-06-30|year|6');
  });

  it('labels fiscal quarters and halves by their ending fiscal year', () => {
    expect(timeframeLabel('2026-09-30', 'quarter', 6)).toBe('Q1 FY 2027');
    expect(timeframeLabel('2026-12-31', 'halfYear', 6)).toBe('H1 FY 2027');
    expect(timeframeLabel('2027-06-30', 'halfYear', 6)).toBe('H2 FY 2027');
  });

  it('formats calendar workspaces like Linear', () => {
    expect(timeframeLabel('2027-06-30', 'month', 0)).toBe('June 2027');
    expect(timeframeLabel('2027-06-30', 'quarter', 0)).toBe('Q2 2027');
    expect(timeframeLabel('2027-06-30', 'halfYear', 0)).toBe('H1 2027');
    expect(timeframeLabel('2027-12-31', 'year', 0)).toBe('2027');
    expect(timeframeLabel('2027-06-17', null, null)).toBe('Jun 17, 2027');
  });

  it('distinguishes exact dates from broad timeframe keys', () => {
    expect(timeframeKey('2027-06-17', null, null)).toBe('2027-06-17|day');
    expect(timeframeKey('2027-06-30', 'quarter', 0)).toBe('2027-06-30|quarter|0');
  });

  it('validates precise and broad anchors', () => {
    expect(
      isCanonicalTimeframeAnchor(
        { date: '2027-06-17', resolution: null, fiscalYearStartMonth: null },
        'target',
      ),
    ).toBe(true);
    expect(
      isCanonicalTimeframeAnchor(
        { date: '2027-06-30', resolution: 'quarter', fiscalYearStartMonth: 0 },
        'target',
      ),
    ).toBe(true);
    expect(
      isCanonicalTimeframeAnchor(
        { date: '2027-06-17', resolution: 'quarter', fiscalYearStartMonth: 0 },
        'target',
      ),
    ).toBe(false);
  });

  it('rejects malformed dates and invalid fiscal months', () => {
    expect(() => timeframeBounds('2027-02-29', 'month', 0)).toThrow(RangeError);
    expect(() => timeframeBounds('not-a-date', 'month', 0)).toThrow(RangeError);
    expect(() => timeframeBounds('2027-01-01', 'quarter', -1)).toThrow(RangeError);
    expect(() => timeframeBounds('2027-01-01', 'quarter', 12)).toThrow(RangeError);
  });

  for (let fiscalMonth = 0; fiscalMonth < 12; fiscalMonth += 1) {
    it(`round-trips every resolution for fiscal month ${String(fiscalMonth)}`, () => {
      for (const resolution of DateResolution.options) {
        const bounds = timeframeBounds('2028-02-29', resolution, fiscalMonth);
        expect(timeframeAnchor(bounds.start, resolution, fiscalMonth, 'start')).toBe(bounds.start);
        expect(timeframeAnchor(bounds.end, resolution, fiscalMonth, 'target')).toBe(bounds.end);
      }
    });
  }
});
