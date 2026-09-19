/** Pure calendar-day cycle schedule behavior. */
import { describe, expect, it } from 'vitest';

import {
  CycleRangeLimitError,
  cycleWindowContaining,
  cycleWindowsThrough,
  isWithinWindow,
  normalizeCadenceDays,
} from '../../src/lib/cycle-window';

describe('normalizeCadenceDays', () => {
  it('accepts every supported whole-day cadence', () => {
    expect(normalizeCadenceDays(1)).toBe(1);
    expect(normalizeCadenceDays(10)).toBe(10);
    expect(normalizeCadenceDays(365)).toBe(365);
  });

  it('falls back to seven days for invalid values', () => {
    for (const invalid of [0, -1, 1.5, 366, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(normalizeCadenceDays(invalid)).toBe(7);
    }
  });
});

describe('cycleWindowsThrough', () => {
  it('creates consecutive one-day windows across a daylight-saving boundary', () => {
    const slots = cycleWindowsThrough({ anchorDate: '2026-03-07', cadenceDays: 1 }, '2026-03-10');
    expect(slots.map((slot) => slot.startDate)).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ]);
    expect(slots.map((slot) => slot.endDate)).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ]);
  });

  it('tiles leap day with a ten-day cadence and no overlap', () => {
    const slots = cycleWindowsThrough(
      { anchorDate: '2026-02-19', cadenceDays: 10 },
      '2028-03-05',
      '2028-02-20',
    );
    expect(slots.map(({ startDate, endDate }) => ({ startDate, endDate }))).toEqual([
      { startDate: '2028-02-19', endDate: '2028-02-28' },
      { startDate: '2028-02-29', endDate: '2028-03-09' },
    ]);
    expect(slots[1]?.startsAt.getTime()).toBe((slots[0]?.endsAt.getTime() ?? 0) + 1);
  });

  it('supports a 365-day cadence', () => {
    const [slot] = cycleWindowsThrough(
      { anchorDate: '2026-01-01', cadenceDays: 365 },
      '2026-12-31',
    );
    expect(slot?.startDate).toBe('2026-01-01');
    expect(slot?.endDate).toBe('2026-12-31');
  });

  it('pages from the window containing a later start date', () => {
    const slots = cycleWindowsThrough(
      { anchorDate: '2024-01-01', cadenceDays: 7 },
      '2030-01-20',
      '2030-01-01',
    );
    expect(slots[0]?.startDate).toBe('2029-12-31');
    expect(slots.at(-1)?.endDate).toBe('2030-01-20');
  });

  it('keeps a window number stable across overlapping requests', () => {
    const schedule = { anchorDate: '2026-01-05', cadenceDays: 7 } as const;
    const first = cycleWindowsThrough(schedule, '2026-02-28');
    const second = cycleWindowsThrough(schedule, '2026-02-28', '2026-02-01');
    const shared = first.find((slot) => slot.startDate === second[0]?.startDate);
    expect(shared?.number).toBe(second[0]?.number);
  });

  it('rejects a request containing more than 400 windows', () => {
    expect(() =>
      cycleWindowsThrough({ anchorDate: '2026-01-01', cadenceDays: 1 }, '2027-02-05'),
    ).toThrow(CycleRangeLimitError);
  });
});

describe('cycleWindowContaining', () => {
  it('finds the same anchored window from any day inside it', () => {
    const schedule = { anchorDate: '2026-01-05', cadenceDays: 10 } as const;
    expect(cycleWindowContaining(schedule, '2026-01-06').startDate).toBe('2026-01-05');
    expect(cycleWindowContaining(schedule, '2026-01-14').startDate).toBe('2026-01-05');
    expect(cycleWindowContaining(schedule, '2026-01-15').startDate).toBe('2026-01-15');
  });
});

describe('isWithinWindow', () => {
  const start = new Date('2026-06-08T00:00:00.000Z');
  const end = new Date('2026-06-14T23:59:59.999Z');

  it('is inclusive on both boundaries and rejects adjacent instants', () => {
    expect(isWithinWindow(start, start, end)).toBe(true);
    expect(isWithinWindow(end, start, end)).toBe(true);
    expect(isWithinWindow(new Date(start.getTime() - 1), start, end)).toBe(false);
    expect(isWithinWindow(new Date(end.getTime() + 1), start, end)).toBe(false);
  });
});
