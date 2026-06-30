/**
 * Unit tests for the agenda normalizer in
 * {@link import('../../src/components/agenda/agenda-context')}.
 *
 * @remarks
 * `toAgendaEntries` is the seam between the Hub `today` payload and every agenda view. The contract:
 *
 * - plan tasks become entries in plan order, each carrying its title/org and a `sort` index;
 * - a timebox window is attached from the `calendar` projection by task id;
 * - a timeboxed block whose task isn't in the plan is appended (so the timeline never drops it);
 * - no data → no entries.
 */
import { HubTodayOut } from '@docket/types';
import { describe, expect, it } from 'vitest';

import { toAgendaEntries } from '@/components/agenda/agenda-context';

const ORG = '01BX5ZZKBKACTAV9WEVGEMMVRZ';
const T1 = '01ARZ3NDEKTSV4RRFFQ69G5FA0';
const T2 = '01ARZ3NDEKTSV4RRFFQ69G5FA1';
const T3 = '01ARZ3NDEKTSV4RRFFQ69G5FA2';

/** Build a valid HubTodayOut from just the plan + calendar we care about. */
function hub(plan: unknown[], calendar: unknown[]): HubTodayOut {
  return HubTodayOut.parse({
    date: '2026-06-29',
    plan,
    calendar,
    needsAttention: { approvals: [], blocked: [], dueToday: [], inbox: 0 },
  });
}

function task(id: string, title = 'Task'): unknown {
  return { id, organizationId: ORG, title, state: 'started', priority: 'medium' };
}

function block(taskId: string, startsAt: string, endsAt: string): unknown {
  return { taskId, organizationId: ORG, startsAt, endsAt };
}

describe('toAgendaEntries', () => {
  it('returns no entries for no data', () => {
    expect(toAgendaEntries(null)).toEqual([]);
  });

  it('maps plan tasks to entries in order, carrying title/org and a sort index', () => {
    const entries = toAgendaEntries(hub([task(T1, 'First'), task(T2, 'Second')], []));
    expect(entries.map((e) => [e.taskId, e.title, e.sort])).toEqual([
      [T1, 'First', 0],
      [T2, 'Second', 1],
    ]);
    expect(entries[0]?.organizationId).toBe(ORG);
    expect(entries[0]?.startsAt).toBeUndefined();
  });

  it('attaches the timebox window from the calendar projection by task id', () => {
    const entries = toAgendaEntries(
      hub(
        [task(T1), task(T2)],
        [block(T2, '2026-06-29T09:00:00.000Z', '2026-06-29T10:00:00.000Z')],
      ),
    );
    const t2 = entries.find((e) => e.taskId === T2);
    expect(t2?.startsAt).toBe('2026-06-29T09:00:00.000Z');
    expect(t2?.endsAt).toBe('2026-06-29T10:00:00.000Z');
    expect(entries.find((e) => e.taskId === T1)?.startsAt).toBeUndefined();
  });

  it('appends a timeboxed block whose task is not in the plan', () => {
    const entries = toAgendaEntries(
      hub([task(T1)], [block(T3, '2026-06-29T13:00:00.000Z', '2026-06-29T13:30:00.000Z')]),
    );
    expect(entries).toHaveLength(2);
    const orphan = entries.find((e) => e.taskId === T3);
    expect(orphan?.title).toBe('Timeboxed work');
    expect(orphan?.startsAt).toBe('2026-06-29T13:00:00.000Z');
  });
});
