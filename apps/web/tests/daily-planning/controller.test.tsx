import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';

const state = vi.hoisted(() => ({
  params: new URLSearchParams(),
  timezone: 'Asia/Tokyo',
  ready: false,
  draft: null as DailyPlanSnapshot | null,
  editing: vi.fn(),
  days: vi.fn(),
  persist: vi.fn(),
  confirm: vi.fn(),
  setStage: vi.fn(),
  go: vi.fn(),
  defer: vi.fn(),
  remove: vi.fn(),
  currentDate: true,
  editDraft: vi.fn(),
}));
vi.mock('../../src/lib/app-location', () => ({ useAppSearchParams: () => state.params }));
vi.mock('../../src/components/time-tracking/use-timer', () => ({
  useTimerState: () => ({ record: null }),
  useTimerControls: () => ({}),
}));
vi.mock('../../src/components/daily-planning/daily-planning-task-state', () => ({
  useDailyPlanningTasks: () => ({
    taskNames: {},
    setEditing: state.editing,
    removeTask: state.remove,
  }),
}));
vi.mock('../../src/components/daily-planning/daily-planning-store', () => ({
  useDailyPlanStore: () => ({
    draft: state.draft,
    isCurrentDate: () => state.currentDate,
    stage: 'plan',
    setStage: state.setStage,
    go: state.go,
    proposalContext: null,
    planningStartAt: '2026-10-07T00:00:00.000Z',
    persist: state.persist,
    serverRevision: { current: 12 },
    revision: 3,
    editDraft: state.editDraft,
    setError: vi.fn(),
  }),
}));
vi.mock('../../src/components/daily-planning/daily-planning-queries', () => ({
  useDailyPlanningPreferences: () => ({
    data: { timezone: state.timezone },
    isSuccess: state.ready,
    isError: false,
  }),
  useDailyPlanningDay: (date: string, enabled: boolean) => {
    state.days(date, enabled);
    return {
      data: { tasks: [], fixedIntervals: [], agenda: { entries: [] }, timezone: state.timezone },
    };
  },
  useDeferDailyTask: () => ({ mutateAsync: state.defer }),
  useAvailableDailyWork: () => ({}),
  useApplyDailyReview: () => ({}),
  useCompleteReviewItem: () => ({}),
  useConfirmDailyPlan: () => ({ mutateAsync: state.confirm }),
}));
import { useDailyPlanningController } from '../../src/components/daily-planning/daily-planning-controller';

beforeEach(() => {
  state.params = new URLSearchParams();
  state.ready = false;
  state.draft = null;
  state.days.mockClear();
  state.editing.mockClear();
  state.persist.mockReset().mockResolvedValue(undefined);
  state.confirm.mockReset().mockResolvedValue({ revision: 13 });
  state.setStage.mockClear();
  state.go.mockClear();
  state.remove.mockClear();
  state.defer.mockReset();
  state.currentDate = true;
  state.editDraft.mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-07T00:30:00.000Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function selectedDraft(): DailyPlanSnapshot {
  return {
    date: '2026-10-07',
    finishAt: '2026-10-07T17:00:00.000Z',
    mainTaskId: null,
    tasks: [{ taskId: 'work', organizationId: 'org', plannedMinutes: 30, sort: 0 }],
    sessions: [
      {
        id: 'block',
        startsAt: '2026-10-07T09:00:00.000Z',
        endsAt: '2026-10-07T09:30:00.000Z',
        allocations: [{ taskId: 'work', plannedMinutes: 30 }],
        pinned: false,
      },
    ],
  };
}
describe('planning entry context', () => {
  it('does not confirm an old-day undo after the save finishes on another date', async () => {
    let finishSave: (() => void) | undefined;
    state.persist.mockImplementation(
      () =>
        new Promise<void>((done) => {
          finishSave = done;
        }),
    );
    const hook = renderHook(() => useDailyPlanningController());
    act(() => {
      hook.result.current.setPreviousAccepted(selectedDraft());
    });
    let undoing: Promise<void> | undefined;
    act(() => {
      undoing = hook.result.current.undoAdjustment();
    });
    state.currentDate = false;
    await act(async () => {
      finishSave?.();
      await undoing;
    });
    expect(state.confirm).not.toHaveBeenCalled();
    expect(state.editDraft).not.toHaveBeenCalled();
  });
  it('does not apply an old-day undo response after confirmation was already sent', async () => {
    let finishConfirm: ((value: { revision: number }) => void) | undefined;
    state.confirm.mockImplementation(
      () =>
        new Promise((done) => {
          finishConfirm = done;
        }),
    );
    const hook = renderHook(() => useDailyPlanningController());
    act(() => {
      hook.result.current.setPreviousAccepted(selectedDraft());
    });
    let undoing: Promise<void> | undefined;
    await act(async () => {
      undoing = hook.result.current.undoAdjustment();
    });
    expect(state.confirm).toHaveBeenCalledTimes(1);
    state.currentDate = false;
    await act(async () => {
      finishConfirm?.({ revision: 13 });
      await undoing;
    });
    expect(state.editDraft).not.toHaveBeenCalled();
  });
  it('guards stage transitions synchronously until moving work finishes', async () => {
    let resolve!: () => void;
    state.defer.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    state.draft = selectedDraft();
    const hook = renderHook(() => useDailyPlanningController());
    let moving!: Promise<void>;
    act(() => {
      moving = hook.result.current.moveTaskToTomorrow('work', 'org');
      hook.result.current.setStage('add');
      void hook.result.current.go('review');
    });
    expect(state.setStage).not.toHaveBeenCalled();
    expect(state.go).not.toHaveBeenCalled();
    expect(hook.result.current.deferPending).toBe(true);
    await act(async () => {
      resolve();
      await moving;
    });
    expect(state.remove).toHaveBeenCalledWith('work', '2026-10-07');
    await act(async () => {
      await hook.result.current.go('review');
    });
    expect(state.go).toHaveBeenCalledWith('review', undefined);
  });
  it('waits for Hub preferences and resolves date-less entry in that timezone', () => {
    const hook = renderHook(() => useDailyPlanningController());
    expect(state.days.mock.calls.every(([, enabled]) => !enabled)).toBe(true);
    act(() => {
      state.ready = true;
      hook.rerender();
    });
    expect(hook.result.current.date).toBe('2026-10-07');
    expect(state.days).toHaveBeenCalledWith('2026-10-07', true);
  });
  it('treats an invalid date as date-less and waits for preferences', () => {
    state.params = new URLSearchParams('date=2026-02-30');
    renderHook(() => useDailyPlanningController());
    expect(state.days.mock.calls.every(([, enabled]) => !enabled)).toBe(true);
  });
  it('opens the requested task block once after the draft arrives', () => {
    state.params = new URLSearchParams('date=2026-10-07&task=work');
    const hook = renderHook(() => useDailyPlanningController());
    expect(state.editing).not.toHaveBeenCalled();
    act(() => {
      state.draft = selectedDraft();
      hook.rerender();
    });
    expect(state.editing).toHaveBeenCalledWith({ taskId: 'work', sessionId: 'block' });
    act(() => {
      hook.rerender();
    });
    expect(state.editing).toHaveBeenCalledTimes(1);
  });
  it('keeps recovery task links in the recovery preview instead of opening the editor', () => {
    state.params = new URLSearchParams('date=2026-10-07&task=work&recovery=still_working');
    state.draft = selectedDraft();
    renderHook(() => useDailyPlanningController());
    expect(state.editing).not.toHaveBeenCalled();
  });
  it('confirms undo only at the revision returned by its guarded save', async () => {
    const hook = renderHook(() => useDailyPlanningController());
    const previous = selectedDraft();
    act(() => {
      hook.result.current.setPreviousAccepted(previous);
    });
    await act(async () => {
      await hook.result.current.undoAdjustment();
    });
    expect(state.persist).toHaveBeenCalledWith(previous, 'review', 3);
    expect(state.confirm).toHaveBeenCalledWith({ expectedRevision: 12 });
  });
  it('opens explicit day review once without replacing a saved tomorrow draft', () => {
    state.params = new URLSearchParams('date=2026-10-08&review=day');
    state.draft = selectedDraft();
    const tomorrow = {
      ...selectedDraft(),
      date: '2026-10-08',
      finishAt: '2026-10-08T17:00:00.000Z',
      sessions: [],
    };
    const hook = renderHook(() => useDailyPlanningController());
    expect(state.setStage).not.toHaveBeenCalled();
    act(() => {
      state.draft = tomorrow;
      hook.rerender();
    });
    expect(hook.result.current.draft).toBe(tomorrow);
    expect(hook.result.current.dayReview).toBe(true);
    expect(hook.result.current.reviewLabel).toBe('Review today');
    expect(state.setStage).toHaveBeenCalledWith('yesterday');
    act(() => {
      hook.rerender();
    });
    expect(state.setStage).toHaveBeenCalledTimes(1);
  });
});
