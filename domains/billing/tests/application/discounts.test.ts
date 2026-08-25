import { describe, expect, it } from 'vitest';

import { calculateUnusedPeriodCredit } from '../../src/application/discounts';

describe('calculateUnusedPeriodCredit', () => {
  it('credits the approved share of the unused recurring service period', () => {
    expect(
      calculateUnusedPeriodCredit({
        recurringAmount: 800,
        percentOff: 50,
        periodStartsAt: new Date('2026-08-01T00:00:00.000Z'),
        periodEndsAt: new Date('2026-09-01T00:00:00.000Z'),
        approvedAt: new Date('2026-08-16T12:00:00.000Z'),
      }),
    ).toBe(200);
  });

  it('rounds to the nearest currency minor unit', () => {
    expect(
      calculateUnusedPeriodCredit({
        recurringAmount: 801,
        percentOff: 33,
        periodStartsAt: new Date('2026-01-01T00:00:00.000Z'),
        periodEndsAt: new Date('2026-01-04T00:00:00.000Z'),
        approvedAt: new Date('2026-01-02T00:00:00.000Z'),
      }),
    ).toBe(176);
  });

  it('returns the full approved discount before the service period starts', () => {
    expect(
      calculateUnusedPeriodCredit({
        recurringAmount: 800,
        percentOff: 50,
        periodStartsAt: new Date('2026-08-01T00:00:00.000Z'),
        periodEndsAt: new Date('2026-09-01T00:00:00.000Z'),
        approvedAt: new Date('2026-07-31T00:00:00.000Z'),
      }),
    ).toBe(400);
  });

  it('returns no credit after the service period ends', () => {
    expect(
      calculateUnusedPeriodCredit({
        recurringAmount: 800,
        percentOff: 50,
        periodStartsAt: new Date('2026-08-01T00:00:00.000Z'),
        periodEndsAt: new Date('2026-09-01T00:00:00.000Z'),
        approvedAt: new Date('2026-09-01T00:00:00.000Z'),
      }),
    ).toBe(0);
  });

  it('rejects invalid award and period values', () => {
    expect(() =>
      calculateUnusedPeriodCredit({
        recurringAmount: 800,
        percentOff: 100,
        periodStartsAt: new Date('2026-08-01T00:00:00.000Z'),
        periodEndsAt: new Date('2026-09-01T00:00:00.000Z'),
        approvedAt: new Date('2026-08-02T00:00:00.000Z'),
      }),
    ).toThrow('percentOff');
    expect(() =>
      calculateUnusedPeriodCredit({
        recurringAmount: 800,
        percentOff: 50,
        periodStartsAt: new Date('2026-09-01T00:00:00.000Z'),
        periodEndsAt: new Date('2026-08-01T00:00:00.000Z'),
        approvedAt: new Date('2026-08-02T00:00:00.000Z'),
      }),
    ).toThrow('period');
  });
});
