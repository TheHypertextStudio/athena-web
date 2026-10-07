import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';

const state = vi.hoisted(() => ({ defer: vi.fn() }));
vi.mock('../../src/components/daily-planning/daily-planning-queries', () => ({
  useRenameDailyTask: () => ({ mutateAsync: vi.fn() }),
  useDeferDailyTask: () => ({ mutateAsync: state.defer }),
}));
import { useDailyPlanningTasks } from '../../src/components/daily-planning/daily-planning-task-state';
import { useDailyPlanningMove } from '../../src/components/daily-planning/daily-planning-move';

const initial: DailyPlanSnapshot = {
  date: '2026-10-07',
  finishAt: '2026-10-07T17:00:00.000Z',
  mainTaskId: 'a',
  sessions: [],
  tasks: ['a', 'b'].map((taskId, sort) => ({
    taskId,
    organizationId: 'org',
    plannedMinutes: 30,
    sort,
  })),
};
function useHarness(date = initial.date, confirming = false) {
  const [draft, editDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const tasks = useDailyPlanningTasks({
    date,
    timezone: 'UTC',
    draft,
    editDraft,
    setError,
    fixed: [],
    startAt: `${date}T09:00:00.000Z`,
    actual: [],
  });
  const move = useDailyPlanningMove({ date, confirming, removeTask: tasks.removeTask, setError });
  return { draft, editDraft, error, ...move };
}
afterEach(cleanup);
beforeEach(() => {
  state.defer.mockReset();
});

describe('moving selected work to tomorrow', () => {
  it('retains newer edits and additions when a deferred move finishes', async () => {
    let resolve!: () => void;
    state.defer.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const hook = renderHook(() => useHarness());
    let moving!: Promise<void>;
    act(() => {
      moving = hook.result.current.moveTaskToTomorrow('a', 'org');
    });
    expect(hook.result.current.isMovingTask()).toBe(true);
    act(() => {
      hook.result.current.editDraft({
        ...initial,
        tasks: [
          ...initial.tasks.filter((task) => task.taskId === 'a'),
          { taskId: 'b', organizationId: 'org', plannedMinutes: 75, sort: 1 },
          { taskId: 'c', organizationId: 'org', plannedMinutes: 45, sort: 2 },
        ],
      });
    });
    await act(async () => {
      resolve();
      await moving;
    });
    expect(
      hook.result.current.draft.tasks.map(({ taskId, plannedMinutes }) => [taskId, plannedMinutes]),
    ).toEqual([
      ['b', 75],
      ['c', 45],
    ]);
    expect(hook.result.current.draft.mainTaskId).toBeNull();
    expect(hook.result.current.draft.settings?.excludedTaskIds).toContain('a');
    expect(hook.result.current.deferPending).toBe(false);
  });
  it('keeps the task and newer edits when the API fails', async () => {
    let reject!: (error: Error) => void;
    state.defer.mockImplementation(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        }),
    );
    const hook = renderHook(() => useHarness());
    let moving!: Promise<void>;
    act(() => {
      moving = hook.result.current.moveTaskToTomorrow('a', 'org');
    });
    act(() => {
      hook.result.current.editDraft({ ...initial, finishAt: '2026-10-07T18:00:00.000Z' });
    });
    await act(async () => {
      reject(new Error('failure'));
      await moving;
    });
    expect(hook.result.current.draft.tasks).toEqual(initial.tasks);
    expect(hook.result.current.draft.finishAt).toBe('2026-10-07T18:00:00.000Z');
    expect(hook.result.current.error).toBe('Could not move this task. Your plan is unchanged.');
  });
  it('does not remove work from a different date after navigation', async () => {
    let resolve!: () => void;
    state.defer.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const hook = renderHook(({ date }) => useHarness(date), {
      initialProps: { date: initial.date },
    });
    let moving!: Promise<void>;
    act(() => {
      moving = hook.result.current.moveTaskToTomorrow('a', 'org');
    });
    act(() => {
      hook.rerender({ date: '2026-10-08' });
      hook.result.current.editDraft({ ...initial, date: '2026-10-08' });
    });
    await act(async () => {
      resolve();
      await moving;
    });
    expect(hook.result.current.draft.tasks).toEqual(initial.tasks);
    expect(hook.result.current.draft.date).toBe('2026-10-08');
  });
  it('blocks duplicate moves synchronously and blocks moves during confirmation', async () => {
    let resolve!: () => void;
    state.defer.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const hook = renderHook(() => useHarness());
    let moving!: Promise<void>;
    act(() => {
      moving = hook.result.current.moveTaskToTomorrow('a', 'org');
      void hook.result.current.moveTaskToTomorrow('b', 'org');
    });
    expect(state.defer).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve();
      await moving;
    });
    const confirming = renderHook(() => useHarness(initial.date, true));
    await act(async () => {
      await confirming.result.current.moveTaskToTomorrow('a', 'org');
    });
    expect(state.defer).toHaveBeenCalledTimes(1);
  });
});
