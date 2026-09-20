import type { CycleOut } from '@docket/work/cycle-contract';
import { describe, expect, it, vi } from 'vitest';

import {
  cycleEnsureRanges,
  endOfNextQuarter,
  ensureCycleRanges,
  groupFutureCycles,
} from '../../src/lib/future-cycle-roster';

const schedule = { anchorDate: '2026-01-01', cadenceDays: 1 };

describe('future cycle roster', () => {
  it('covers the end of the next calendar quarter', () => {
    expect(endOfNextQuarter('2026-09-19')).toBe('2026-12-31');
    expect(endOfNextQuarter('2026-12-01')).toBe('2027-03-31');
  });

  it('pages arbitrarily distant daily targets into at most 400-window requests', () => {
    const ranges = cycleEnsureRanges(schedule, '2026-01-01', '2029-12-31');
    expect(ranges).toHaveLength(4);
    expect(ranges[0]).toEqual({ fromDate: '2026-01-01', throughDate: '2027-02-04' });
    expect(ranges.at(-1)?.throughDate).toBe('2029-12-31');
  });

  it('ensures every bounded page in order', async () => {
    const ensure = vi.fn().mockResolvedValue(undefined);
    await ensureCycleRanges(schedule, '2026-01-01', '2029-12-31', ensure);
    expect(ensure).toHaveBeenCalledTimes(4);
    expect(ensure.mock.calls[1]?.[0].fromDate).toBe('2027-02-05');
  });

  it('orders current and upcoming cycles while retaining only the selected completed cycle', () => {
    const cycles = [
      cycle('completed-selected', '2026-09-01', '2026-09-07', 'completed'),
      cycle('upcoming-b', '2026-09-15', '2026-09-21', 'upcoming'),
      cycle('completed-hidden', '2026-08-01', '2026-08-07', 'completed'),
      cycle('current', '2026-09-08', '2026-09-14', 'active', true),
      cycle('upcoming-a', '2026-09-14', '2026-09-14', 'upcoming'),
    ];
    const grouped = groupFutureCycles(cycles, 'TEAM', 'completed-selected', '2026-09-10');
    expect(grouped.retained.map(({ id }) => id)).toEqual(['completed-selected']);
    expect(grouped.current.map(({ id }) => id)).toEqual(['current']);
    expect(grouped.upcoming.map(({ id }) => id)).toEqual(['upcoming-a', 'upcoming-b']);
  });
});

function cycle(
  id: string,
  startDate: string,
  endDate: string,
  status: CycleOut['status'],
  isCurrent = false,
): CycleOut {
  return {
    id,
    organizationId: 'ORG',
    teamId: 'TEAM',
    number: 1,
    name: null,
    displayName: id,
    startsAt: `${startDate}T00:00:00.000Z`,
    endsAt: `${endDate}T23:59:59.999Z`,
    status,
    isCurrent,
    createdAt: '2026-01-01T00:00:00.000Z',
  } as CycleOut;
}
