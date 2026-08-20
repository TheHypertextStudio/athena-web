import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../src/error';
import { assertPlanningDateRange, planningDatePatch } from '../../src/lib/planning-timeframe';

describe('planningDatePatch', () => {
  it('keeps a precise day free of broad-period metadata', () => {
    expect(
      planningDatePatch(
        { date: '2026-05-12', resolution: null },
        3,
        'start',
        'startDate',
        'startDateResolution',
      ),
    ).toEqual({
      date: new Date('2026-05-12T00:00:00.000Z'),
      resolution: null,
      fiscalYearStartMonth: null,
    });
  });

  it('stamps the workspace fiscal basis on a canonical broad period', () => {
    expect(
      planningDatePatch(
        { date: '2026-04-01', resolution: 'quarter' },
        3,
        'start',
        'startDate',
        'startDateResolution',
      ),
    ).toEqual({
      date: new Date('2026-04-01T00:00:00.000Z'),
      resolution: 'quarter',
      fiscalYearStartMonth: 3,
    });
    expect(
      planningDatePatch(
        { date: '2026-06-30', resolution: 'quarter' },
        3,
        'target',
        'targetDate',
        'targetDateResolution',
      ),
    ).toEqual({
      date: new Date('2026-06-30T00:00:00.000Z'),
      resolution: 'quarter',
      fiscalYearStartMonth: 3,
    });
  });

  it('clears a planning date and all metadata together', () => {
    expect(
      planningDatePatch({ date: null }, 0, 'target', 'targetDate', 'targetDateResolution'),
    ).toEqual({ date: null, resolution: null, fiscalYearStartMonth: null });
  });

  it('returns undefined when neither member of the pair was supplied', () => {
    expect(
      planningDatePatch({}, 0, 'target', 'targetDate', 'targetDateResolution'),
    ).toBeUndefined();
  });

  it('rejects a resolution without its date', () => {
    expect(() =>
      planningDatePatch({ resolution: 'month' }, 0, 'target', 'targetDate', 'targetDateResolution'),
    ).toThrow(ValidationError);
  });

  it('rejects broad metadata on a cleared date', () => {
    expect(() =>
      planningDatePatch(
        { date: null, resolution: 'year' },
        0,
        'target',
        'targetDate',
        'targetDateResolution',
      ),
    ).toThrow(ValidationError);
  });

  it('rejects a broad date that is not the canonical field boundary', () => {
    expect(() =>
      planningDatePatch(
        { date: '2026-05-12', resolution: 'quarter' },
        3,
        'start',
        'startDate',
        'startDateResolution',
      ),
    ).toThrow(ValidationError);
    expect(() =>
      planningDatePatch(
        { date: '2026-06-01', resolution: 'quarter' },
        3,
        'target',
        'targetDate',
        'targetDateResolution',
      ),
    ).toThrow(ValidationError);
  });
});

describe('assertPlanningDateRange', () => {
  it('accepts open and ordered ranges', () => {
    expect(() => {
      assertPlanningDateRange(null, new Date('2026-06-30T00:00:00.000Z'));
    }).not.toThrow();
    expect(() => {
      assertPlanningDateRange(
        new Date('2026-04-01T00:00:00.000Z'),
        new Date('2026-06-30T00:00:00.000Z'),
      );
    }).not.toThrow();
  });

  it('rejects a target before the start', () => {
    expect(() => {
      assertPlanningDateRange(
        new Date('2026-07-01T00:00:00.000Z'),
        new Date('2026-06-30T00:00:00.000Z'),
      );
    }).toThrow(ValidationError);
  });
});
