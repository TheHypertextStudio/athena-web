import { describe, expect, it, vi } from 'vitest';

import { TaskViewRow } from '@docket/work/work-view-contract';

import {
  buildWorkListRootContinuation,
  buildWorkListRoster,
  workListMembershipKey,
} from '../../src/components/work-views/work-list-groups';

function task(id: string, title: string) {
  return TaskViewRow.parse({
    target: 'task',
    organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
    id,
    title,
    status: 'todo',
    priority: 'medium',
    assignee: null,
    delegate: null,
    team: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
    project: null,
    program: null,
    cycle: null,
    milestone: null,
    parent: null,
    labels: [],
    creator: null,
    startDate: null,
    dueDate: null,
    createdAt: '2026-08-21T12:00:00.000Z',
    updatedAt: '2026-08-21T12:00:00.000Z',
    estimate: null,
    estimateMinutes: null,
    blocked: false,
    blocking: false,
    unfiled: true,
    archived: false,
    manualRank: 'a0',
    isContext: false,
  });
}

describe('buildWorkListRoster', () => {
  it('preserves server summary order, server counts, nested paths, and membership identity', () => {
    const duplicate = task('01ARZ3NDEKTSV4RRFFQ69G5FC0', 'Duplicate task');
    const roster = buildWorkListRoster({
      target: 'task',
      grouped: true,
      rows: [],
      summaries: [
        { path: ['active'], key: 'active', label: 'Active', count: 101 },
        { path: ['active', 'high'], key: 'high', label: 'High', count: 60 },
        { path: ['active', 'low'], key: 'low', label: 'Low', count: 41 },
        { path: ['planned'], key: 'planned', label: 'Planned', count: 7 },
      ],
      pages: [
        { path: ['planned'], rows: [duplicate], nextCursor: null, loading: false },
        { path: ['active', 'low'], rows: [duplicate], nextCursor: null, loading: false },
        { path: ['active', 'high'], rows: [duplicate], nextCursor: null, loading: false },
      ],
    });

    expect(roster.groups?.map(({ id, count }) => [id, count])).toEqual([
      ['active', 101],
      ['planned', 7],
    ]);
    expect(roster.groups?.[0]?.children?.map(({ id, count }) => [id, count])).toEqual([
      ['active/high', 60],
      ['active/low', 41],
    ]);
    expect(roster.memberships.map(({ key }) => key)).toEqual([
      workListMembershipKey(['active', 'high'], duplicate.id),
      workListMembershipKey(['active', 'low'], duplicate.id),
      workListMembershipKey(['planned'], duplicate.id),
    ]);
    expect(new Set(roster.memberships.map(({ key }) => key)).size).toBe(3);
  });

  it('keeps one typed continuation on its exact path through loading and retry states', () => {
    const onLoadMore = vi.fn();
    const loadedRows = Array.from({ length: 100 }, (_, index) =>
      task(
        `01ARZ3NDEKTSV4RRFFQ69${String(index).padStart(5, '0')}`,
        `Active task ${String(index)}`,
      ),
    );
    const page = {
      path: ['active'],
      rows: loadedRows,
      nextCursor: 'next-active',
      loading: false,
    } as const;
    const input = {
      target: 'task' as const,
      grouped: true,
      rows: [],
      summaries: [{ path: ['active'], key: 'active', label: 'Active', count: 101 }],
      onLoadMore,
    };

    const idle = buildWorkListRoster({ ...input, pages: [page] }).groups?.[0]?.continuation;
    expect(buildWorkListRoster({ ...input, pages: [page] }).groups?.[0]?.rows).toHaveLength(100);
    expect(idle).toMatchObject({
      id: 'work-list-continuation:active',
      label: 'Load more Active',
      state: 'idle',
    });
    if (idle?.state !== 'idle') throw new Error('The Active continuation was not idle.');
    idle.onActivate();
    expect(onLoadMore).toHaveBeenCalledWith(['active']);

    const loading = buildWorkListRoster({
      ...input,
      pages: [{ ...page, loading: true }],
    }).groups?.[0]?.continuation;
    expect(loading).toEqual({
      id: 'work-list-continuation:active',
      label: 'Loading Active',
      state: 'loading',
    });

    const retry = buildWorkListRoster({
      ...input,
      pages: [{ ...page, nextCursor: null, retryCursor: 'next-active', error: new Error('nope') }],
    }).groups?.[0]?.continuation;
    expect(retry).toMatchObject({
      id: 'work-list-continuation:active',
      label: 'Retry Active',
      state: 'error',
    });
  });

  it('renders root continuation recovery through the same typed contract', () => {
    const retry = vi.fn();
    const continuation = buildWorkListRootContinuation(
      'task',
      false,
      false,
      new Error('failed'),
      retry,
    );
    expect(continuation).toMatchObject({
      id: 'work-list-continuation:root:task',
      label: 'Retry Tasks',
      state: 'error',
    });
  });
});
