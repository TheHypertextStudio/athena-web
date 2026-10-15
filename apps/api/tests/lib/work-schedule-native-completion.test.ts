import { describe, expect, it } from 'vitest';
import {
  nativeCompletionState,
  nativeNextCompletionDate,
} from '../../src/lib/recurrence/schedule-native-completion-plan';

describe('native concrete schedule completion', () => {
  const roots = [{ kind: 'project' as const, id: 'dinner' }];
  it('requires the actual root and all living descendant work to be terminal', () => {
    expect(
      nativeCompletionState(roots, [
        { kind: 'project', id: 'dinner', state: 'completed' },
        { kind: 'task', id: 'deposit', state: 'started' },
      ]),
    ).toBe('open');
    expect(
      nativeCompletionState(roots, [
        { kind: 'project', id: 'dinner', state: 'completed' },
        { kind: 'task', id: 'deposit', state: 'canceled' },
      ]),
    ).toBe('completed');
    expect(
      nativeCompletionState(roots, [
        { kind: 'project', id: 'dinner', state: 'started' },
        { kind: 'task', id: 'deposit', state: 'completed' },
      ]),
    ).toBe('open');
  });
  it('never advances a deleted or canceled root', () => {
    expect(nativeCompletionState(roots, [])).toBe('open');
    expect(
      nativeCompletionState(roots, [{ kind: 'project', id: 'dinner', state: 'canceled' }]),
    ).toBe('canceled');
  });
  it('uses the schedule timezone at a DST boundary and clamps monthly completion cadence', () => {
    expect(
      nativeNextCompletionDate('2026-11-02T00:30:00.000Z', 'America/Los_Angeles', 1, 'day'),
    ).toBe('2026-11-02');
    expect(nativeNextCompletionDate('2026-11-02T00:30:00.000Z', 'UTC', 1, 'day')).toBe(
      '2026-11-03',
    );
    expect(
      nativeNextCompletionDate('2027-01-31T20:00:00.000Z', 'America/Los_Angeles', 1, 'month'),
    ).toBe('2027-02-28');
  });
});
