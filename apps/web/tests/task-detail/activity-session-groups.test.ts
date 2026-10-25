import { describe, expect, it } from 'vitest';
import type { TaskActivityOut } from '@docket/connections/activity-contract';
import { activitySessionGroups } from '../../src/components/task-detail/activity-session-groups';

function entry(id: string, sessionId: string | null): TaskActivityOut {
  return {
    id,
    taskId: 'task' as TaskActivityOut['taskId'],
    actorId: null,
    actorName: null,
    type: 'updated',
    category: 'task',
    change: null,
    body: null,
    createdAt: '2026-10-25T12:00:00Z',
    origin: null,
    subjectTaskId: null,
    subjectTaskTitle: null,
    session: sessionId ? { id: sessionId, kind: 'work', title: 'Codex session' } : null,
  };
}

describe('activity session contributions', () => {
  it('merges adjacent contributions across page boundaries and preserves human interruptions', () => {
    const groups = activitySessionGroups([
      entry('a', 'work'),
      entry('b', 'work'),
      entry('c', null),
      entry('d', 'work'),
    ]);
    expect(groups.map((group) => group.entries.map((item) => item.id))).toEqual([
      ['a', 'b'],
      ['c'],
      ['d'],
    ]);
    expect(groups.map((group) => group.continued)).toEqual([false, false, true]);
  });
  it('never combines different sessions or uncorrelated entries', () => {
    expect(
      activitySessionGroups([
        entry('a', 'one'),
        entry('b', 'two'),
        entry('c', null),
        entry('d', null),
      ]),
    ).toHaveLength(4);
  });
  it('deduplicates retried pages by durable entry identity', () => {
    const groups = activitySessionGroups([entry('a', 'one'), entry('a', 'one'), entry('b', 'one')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.entries.map((item) => item.id)).toEqual(['a', 'b']);
  });
});
