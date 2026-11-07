import { describe, expect, it } from 'vitest';

import { measureHumanProgress } from '../../src/time/commitment-progress';

const start = Date.parse('2026-11-06T09:00:00Z');
const end = Date.parse('2026-11-06T12:00:00Z');
const now = Date.parse('2026-11-06T11:00:00Z');
const span = (startedAt: string, endedAt: string | null, overrides = {}) => ({
  startedAt,
  endedAt,
  actorKind: 'human',
  mode: 'human_active',
  source: 'user_timer',
  userId: 'owner',
  supersededById: null,
  ...overrides,
});

describe('commitment time progress', () => {
  it('clips and merges overlapping human sessions without counting breaks or future time', () => {
    expect(
      measureHumanProgress(
        [
          span('2026-11-06T08:30:00Z', '2026-11-06T09:30:00Z'),
          span('2026-11-06T09:15:00Z', '2026-11-06T10:00:00Z'),
          span('2026-11-06T10:30:00Z', null),
        ],
        { start, end, now, userId: 'owner', includeManual: false },
      ),
    ).toBe(90 * 60_000);
  });

  it('excludes agent, other users, replaced and manually entered time by default', () => {
    const base = ['2026-11-06T09:00:00Z', '2026-11-06T10:00:00Z'] as const;
    const intervals = [
      span(...base, { mode: 'agent_active' }),
      span(...base, { actorKind: 'agent' }),
      span(...base, { userId: 'other' }),
      span(...base, { supersededById: 'replacement' }),
      span(...base, { source: 'manual_entry' }),
    ];
    expect(
      measureHumanProgress(intervals, { start, end, now, userId: 'owner', includeManual: false }),
    ).toBe(0);
    expect(
      measureHumanProgress(intervals, { start, end, now, userId: 'owner', includeManual: true }),
    ).toBe(60 * 60_000);
  });
  it('ignores future, invalid, empty, and reversed intervals', () => {
    const intervals = [
      span('2026-11-06T11:30:00Z', '2026-11-06T12:00:00Z'),
      span('bad', '2026-11-06T10:00:00Z'),
      span('2026-11-06T10:00:00Z', '2026-11-06T09:00:00Z'),
      span('2026-11-06T10:00:00Z', '2026-11-06T10:00:00Z'),
    ];
    expect(
      measureHumanProgress(intervals, { start, end, now, userId: 'owner', includeManual: true }),
    ).toBe(0);
  });
});
