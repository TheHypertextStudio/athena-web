import { describe, expect, it } from 'vitest';
import { requireFutureScheduleBoundary } from '../../src/lib/recurrence/schedule-future-boundary';
const now = new Date('2026-10-16T02:00:00Z');
const base = {
  status: 'active' as const,
  latestEffectiveFrom: '2026-10-01',
  effectiveFrom: '2026-10-15',
  timezone: 'America/Los_Angeles',
};
describe('future schedule revision boundary', () => {
  it('accepts today in the saved timezone and future paused edits', () => {
    expect(() => {
      requireFutureScheduleBoundary(base, now);
    }).not.toThrow();
    expect(() => {
      requireFutureScheduleBoundary(
        { ...base, status: 'paused', effectiveFrom: '2026-11-01' },
        now,
      );
    }).not.toThrow();
  });
  it('refuses changes before the saved civil day', () => {
    expect(() => {
      requireFutureScheduleBoundary({ ...base, effectiveFrom: '2026-10-14' }, now);
    }).toThrow('past');
    expect(() => {
      requireFutureScheduleBoundary({ ...base, timezone: 'Pacific/Auckland' }, now);
    }).toThrow('past');
  });
  it('refuses equal or backwards revision boundaries regardless of publication selection', () => {
    for (const effectiveFrom of ['2026-11-01', '2026-10-31'])
      expect(() => {
        requireFutureScheduleBoundary(
          { ...base, latestEffectiveFrom: '2026-11-01', effectiveFrom },
          now,
        );
      }).toThrow('latest');
  });
  it('refuses future revisions of an ended schedule', () => {
    expect(() => {
      requireFutureScheduleBoundary({ ...base, status: 'ended', effectiveFrom: '2026-12-01' }, now);
    }).toThrow('Ended');
  });
});
