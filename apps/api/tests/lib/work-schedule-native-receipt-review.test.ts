import { describe, expect, it } from 'vitest';
import type { NativeScheduleDateOwnership } from '@docket/db';
import { nativeScheduleDateChanges } from '../../src/mcp/change-set-native-dates';
const before: NativeScheduleDateOwnership = {
  rootKey: 'root',
  path: [],
  kind: 'task',
  id: 'venue',
  field: 'dueDate',
  anchor: { kind: 'run' },
  manual: false,
  lastDerivedDate: '2026-10-06',
};
describe('action-owned native pin receipts', () => {
  it('excludes recognition of an earlier authored divergence from later anchor undo', () => {
    expect(
      nativeScheduleDateChanges(
        'run',
        [before],
        [{ ...before, manual: true }],
        new Set(['venue:dueDate']),
      ),
    ).toEqual([]);
  });
  it('keeps an explicit same-value pin reversible even without a physical date change', () => {
    expect(nativeScheduleDateChanges('run', [before], [{ ...before, manual: true }])).toHaveLength(
      1,
    );
  });
  it('never excludes changed derived facts or a different explicit pin merely because another consumer diverged', () => {
    expect(
      nativeScheduleDateChanges(
        'run',
        [before],
        [{ ...before, manual: true, lastDerivedDate: '2026-10-07' }],
        new Set(['venue:dueDate']),
      ),
    ).toHaveLength(1);
    expect(
      nativeScheduleDateChanges(
        'run',
        [before],
        [{ ...before, manual: true }],
        new Set(['other:dueDate']),
      ),
    ).toHaveLength(1);
  });
});
