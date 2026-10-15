import { expect, it } from 'vitest';
import { canRetryScheduleOccurrence } from '../../src/lib/recurrence/schedule-run-recovery';
const run = {
  runKind: 'scheduled' as const,
  status: 'needs_resolution' as const,
  seriesId: 'series',
  seriesRevisionId: 'revision',
  blueprintAppliedAt: null,
};
it('offers failed work and missed decisions through the same durable recovery eligibility', () => {
  expect(canRetryScheduleOccurrence(run)).toBe(true);
  expect(canRetryScheduleOccurrence({ ...run, status: 'failed' })).toBe(true);
});
it('never offers recovery for applied, detached or historical work', () => {
  expect(canRetryScheduleOccurrence({ ...run, blueprintAppliedAt: new Date() })).toBe(false);
  expect(canRetryScheduleOccurrence({ ...run, seriesId: null })).toBe(false);
  expect(canRetryScheduleOccurrence({ ...run, seriesRevisionId: null })).toBe(false);
  expect(canRetryScheduleOccurrence({ ...run, runKind: 'historical' })).toBe(false);
});
it.each(['materialized', 'completed', 'skipped', 'canceled', 'superseded', 'expected'] as const)(
  'does not turn %s into a retry decision',
  (status) => {
    expect(canRetryScheduleOccurrence({ ...run, status })).toBe(false);
  },
);
