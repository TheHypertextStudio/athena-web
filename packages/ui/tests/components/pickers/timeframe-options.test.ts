import { describe, expect, it } from 'vitest';

import {
  nearbyTimeframeOptions,
  timeframeResolutionMonths,
} from '../../../src/components/pickers/timeframe-options';

describe('timeframeResolutionMonths', () => {
  it.each([
    ['month', 1],
    ['quarter', 3],
    ['halfYear', 6],
    ['year', 12],
  ] as const)('maps %s to %i calendar months', (resolution, months) => {
    expect(timeframeResolutionMonths(resolution)).toBe(months);
  });
});

describe('nearbyTimeframeOptions', () => {
  it('builds seven start anchors around the current month', () => {
    expect(nearbyTimeframeOptions('2026-01-15', 'month', 0, 'start')).toEqual([
      {
        date: '2025-11-01',
        resolution: 'month',
        fiscalYearStartMonth: 0,
        label: 'November 2025',
      },
      {
        date: '2025-12-01',
        resolution: 'month',
        fiscalYearStartMonth: 0,
        label: 'December 2025',
      },
      {
        date: '2026-01-01',
        resolution: 'month',
        fiscalYearStartMonth: 0,
        label: 'January 2026',
      },
      {
        date: '2026-02-01',
        resolution: 'month',
        fiscalYearStartMonth: 0,
        label: 'February 2026',
      },
      {
        date: '2026-03-01',
        resolution: 'month',
        fiscalYearStartMonth: 0,
        label: 'March 2026',
      },
      {
        date: '2026-04-01',
        resolution: 'month',
        fiscalYearStartMonth: 0,
        label: 'April 2026',
      },
      {
        date: '2026-05-01',
        resolution: 'month',
        fiscalYearStartMonth: 0,
        label: 'May 2026',
      },
    ]);
  });

  it('uses target anchors and keeps the fiscal calendar on every option', () => {
    const options = nearbyTimeframeOptions('2026-05-15', 'quarter', 3, 'target');

    expect(options).toHaveLength(7);
    expect(options[2]).toEqual({
      date: '2026-06-30',
      resolution: 'quarter',
      fiscalYearStartMonth: 3,
      label: 'Q1 FY 2027',
    });
  });

  it('moves the seven-period window and removes anchors outside product bounds', () => {
    const shifted = nearbyTimeframeOptions('2026-01-15', 'year', 0, 'start', 7);
    const bounded = nearbyTimeframeOptions('2200-12-15', 'halfYear', 0, 'target', 7);

    expect(shifted[0]?.date).toBe('2031-01-01');
    expect(shifted[6]?.date).toBe('2037-01-01');
    expect(bounded).toEqual([]);
  });
});
