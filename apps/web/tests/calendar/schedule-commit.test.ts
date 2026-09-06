/**
 * Unit tests for {@link import('../../src/components/calendar/item-drawer/schedule-commit')}.
 *
 * @remarks
 * These are the regression net for the daylight-saving fold rules, which used to live inside the
 * editor component and could only be exercised by rendering it. They cover the four outcomes a
 * schedule edit can have: nothing to write, a refused edit inside a repeated hour, a refused
 * backwards range, and a patch.
 */
import type { CalendarItemOut } from '@docket/planning/calendar-contract';
import { describe, expect, it } from 'vitest';

import {
  resolveSchedulePatch,
  type ScheduleCommitInput,
} from '../../src/components/calendar/item-drawer/schedule-commit';

const LOS_ANGELES = 'America/Los_Angeles';

function timedItem(overrides: Partial<CalendarItemOut> = {}): CalendarItemOut {
  return {
    startsAt: '2026-11-01T08:30:00.000Z',
    endsAt: '2026-11-01T09:30:00.000Z',
    allDayStartDate: null,
    allDayEndDate: null,
    ...overrides,
  } as CalendarItemOut;
}

function allDayItem(start: string | null, end: string | null): CalendarItemOut {
  return {
    startsAt: null,
    endsAt: null,
    allDayStartDate: start,
    allDayEndDate: end,
  } as CalendarItemOut;
}

function input(overrides: Partial<ScheduleCommitInput>): ScheduleCommitInput {
  return {
    item: timedItem(),
    displayTimezone: LOS_ANGELES,
    start: { wallValue: '', occurrence: null, edited: false },
    end: { wallValue: '', occurrence: null, edited: false },
    allDayStart: '',
    allDayEnd: '',
    ...overrides,
  };
}

describe('resolveSchedulePatch', () => {
  it('writes nothing when no schedule field was touched', () => {
    expect(resolveSchedulePatch(input({}))).toEqual({ kind: 'noop' });
  });

  it('refuses a repeated wall-clock hour until the person says which one they meant', () => {
    // 1:30 AM on 2026-11-01 happens twice in Los Angeles.
    const commit = resolveSchedulePatch(
      input({
        start: { wallValue: '2026-11-01T01:30', occurrence: null, edited: true },
      }),
    );
    expect(commit).toEqual({
      kind: 'error',
      reason: 'Choose Earlier or Later for the repeated start time.',
    });
  });

  it('resolves a repeated hour once the fold is chosen', () => {
    const commit = resolveSchedulePatch(
      input({
        item: timedItem({ endsAt: '2026-11-01T18:00:00.000Z' }),
        start: { wallValue: '2026-11-01T01:30', occurrence: 'later', edited: true },
      }),
    );
    expect(commit.kind).toBe('patch');
    // The later fold is Pacific Standard Time, eight hours behind UTC.
    expect(commit.kind === 'patch' ? commit.patch.startsAt : null).toBe('2026-11-01T09:30:00Z');
  });

  it('refuses an end that lands on or before its start', () => {
    const commit = resolveSchedulePatch(
      input({
        item: timedItem({ startsAt: '2026-07-01T16:00:00.000Z' }),
        end: { wallValue: '2026-07-01T08:00', occurrence: null, edited: true },
      }),
    );
    expect(commit).toEqual({ kind: 'error', reason: 'End must be after start.' });
  });

  it('leaves an untouched bound at its saved instant', () => {
    const commit = resolveSchedulePatch(
      input({
        end: { wallValue: '2026-11-01T04:00', occurrence: null, edited: true },
      }),
    );
    expect(commit.kind === 'patch' ? commit.patch.startsAt : null).toBe('2026-11-01T08:30:00.000Z');
  });

  it('writes nothing when an all-day range is unchanged', () => {
    const commit = resolveSchedulePatch(
      input({
        item: allDayItem('2026-07-01', '2026-07-03'),
        allDayStart: '2026-07-01',
        allDayEnd: '2026-07-02',
      }),
    );
    expect(commit).toEqual({ kind: 'noop' });
  });

  it('converts the inclusive day a person picks into the exclusive end the API stores', () => {
    const commit = resolveSchedulePatch(
      input({
        item: allDayItem('2026-07-01', '2026-07-02'),
        allDayStart: '2026-07-01',
        allDayEnd: '2026-07-03',
      }),
    );
    expect(commit).toEqual({
      kind: 'patch',
      patch: { allDayStartDate: '2026-07-01', allDayEndDate: '2026-07-04' },
    });
  });

  it('refuses an all-day range that ends before it starts', () => {
    const commit = resolveSchedulePatch(
      input({
        item: allDayItem('2026-07-05', '2026-07-06'),
        allDayStart: '2026-07-05',
        allDayEnd: '2026-07-01',
      }),
    );
    expect(commit).toEqual({ kind: 'error', reason: 'End must be after start.' });
  });
});
