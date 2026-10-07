import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import type { DayData } from '../../src/components/daily-planning/daily-planning-controller';

const state = vi.hoisted(() => ({ save: vi.fn(), propose: vi.fn(), refetch: vi.fn() }));
vi.mock('../../src/components/daily-planning/daily-planning-queries', () => ({
  useSaveDailyDraft: () => ({ mutateAsync: state.save }),
  useDailyPlanProposal: () => ({ mutateAsync: state.propose, isPending: false }),
  useDailyPlanningDay: () => ({ refetch: state.refetch }),
}));
import { useDailyPlanStore } from '../../src/components/daily-planning/daily-planning-store';

const date = '2026-10-07';
const draft: DailyPlanSnapshot = {
  date,
  finishAt: '2026-10-07T17:00:00.000Z',
  mainTaskId: null,
  tasks: [],
  sessions: [],
};
const day = (saved: DailyPlanSnapshot | null = draft): DayData => ({
  date,
  draft: saved,
  revision: 5,
  accepted: null,
  resumeStep: 'plan_today',
  timezone: 'UTC',
  tasks: [],
  carryover: [],
  agenda: { date, entries: [] },
  fixedIntervals: [],
  actual: [],
});
const input = (saved: DailyPlanSnapshot | null = draft) => ({
  date,
  day: day(saved),
  previous: day(null),
  missedId: null,
  recovery: null,
});
const proposal = (value = draft) => ({
  draft: value,
  revision: 6,
  startAt: '2026-10-07T09:00:00.000Z',
  availableMinutes: 480,
  bufferMinutes: 60,
  tasks: [],
  fixedIntervals: [],
  unplaced: [],
  changes: [],
  workScheduleMissing: false,
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  state.save.mockReset().mockResolvedValue({ revision: 6 });
  state.propose.mockReset().mockResolvedValue(proposal());
  state.refetch.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

describe('planning date changes during pending work', () => {
  it('discards an old visit completion after returning to the same date', async () => {
    const hook = renderHook((value) => useDailyPlanStore(value), { initialProps: input() });
    await advance(0);
    let finishSave: ((value: { revision: number }) => void) | undefined;
    state.save.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finishSave = done;
        }),
    );
    const previous = hook.result.current;
    const replacement = { ...draft, finishAt: '2026-10-07T19:00:00.000Z' };
    let transition: Promise<void> | undefined;
    act(() => {
      transition = previous.go('review', replacement);
    });
    await advance(0);
    const next = { ...draft, date: '2026-10-08', finishAt: '2026-10-08T17:00:00.000Z' };
    state.propose.mockResolvedValue(proposal(next));
    act(() => {
      hook.rerender({ ...input(next), date: next.date, day: { ...day(next), date: next.date } });
    });
    await advance(0);
    state.propose.mockResolvedValue(proposal());
    act(() => {
      hook.rerender({ ...input(), day: { ...day(), revision: 20 } });
    });
    await advance(0);
    const edited = { ...draft, finishAt: '2026-10-07T18:00:00.000Z' };
    act(() => {
      hook.result.current.editDraft(edited);
    });
    await act(async () => {
      finishSave?.({ revision: 6 });
      await transition;
    });
    expect(hook.result.current.draft).toEqual(edited);
    expect(hook.result.current.stage).toBe('plan');
    expect(hook.result.current.serverRevision.current).toBe(20);
    expect(previous.isCurrentDate()).toBe(false);
  });
  it('ignores prior-date edit and stage callbacks retained by a pending action', async () => {
    const hook = renderHook((value) => useDailyPlanStore(value), { initialProps: input() });
    await advance(0);
    const previous = hook.result.current;
    const next = { ...draft, date: '2026-10-08', finishAt: '2026-10-08T17:00:00.000Z' };
    state.propose.mockResolvedValue(proposal(next));
    act(() => {
      hook.rerender({
        ...input(next),
        date: next.date,
        day: { ...day(next), date: next.date, revision: 20 },
      });
    });
    await advance(0);
    act(() => {
      previous.editDraft(draft);
      previous.setStage('review');
      void previous.go('review', draft);
    });
    expect(hook.result.current.draft).toEqual(next);
    expect(hook.result.current.stage).toBe('plan');
    await act(async () => {
      await hook.result.current.go('review');
    });
    expect(hook.result.current.stage).toBe('review');
  });
  it('does not install a delayed stage replacement after changing the planning date', async () => {
    const hook = renderHook((value) => useDailyPlanStore(value), { initialProps: input() });
    await advance(0);
    let finishSave: ((value: { revision: number }) => void) | undefined;
    state.save.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finishSave = done;
        }),
    );
    const replacement = { ...draft, finishAt: '2026-10-07T19:00:00.000Z' };
    let transition: Promise<void> | undefined;
    act(() => {
      transition = hook.result.current.go('review', replacement);
    });
    await advance(0);
    const next = { ...draft, date: '2026-10-08', finishAt: '2026-10-08T17:00:00.000Z' };
    state.propose.mockResolvedValue(proposal(next));
    act(() => {
      hook.rerender({
        ...input(next),
        date: next.date,
        day: { ...day(next), date: next.date, revision: 20 },
      });
    });
    await advance(0);
    const edited = { ...next, finishAt: '2026-10-08T18:00:00.000Z' };
    act(() => {
      hook.result.current.editDraft(edited);
    });
    await act(async () => {
      finishSave?.({ revision: 6 });
      await transition;
    });
    expect(hook.result.current.draft).toEqual(edited);
    expect(hook.result.current.stage).toBe('plan');
    expect(hook.result.current.serverRevision.current).toBe(20);
  });
  it('discards a saved-plan review response from the prior date', async () => {
    const hook = renderHook((value) => useDailyPlanStore(value), { initialProps: input() });
    await advance(0);
    let finishReview: ((value: unknown) => void) | undefined;
    state.refetch.mockImplementation(
      () =>
        new Promise((done) => {
          finishReview = done;
        }),
    );
    let reviewing: Promise<void> | undefined;
    act(() => {
      reviewing = hook.result.current.reviewSavedDraft();
    });
    const next = { ...draft, date: '2026-10-08', finishAt: '2026-10-08T17:00:00.000Z' };
    state.propose.mockResolvedValue(proposal(next));
    act(() => {
      hook.rerender({
        ...input(next),
        date: next.date,
        day: { ...day(next), date: next.date, revision: 20 },
      });
    });
    await advance(0);
    await act(async () => {
      finishReview?.({ isSuccess: true, data: day(draft) });
      await reviewing;
    });
    expect(hook.result.current.savedDraftReview).toBeNull();
    expect(hook.result.current.draft).toEqual(next);
  });
  it('does not install a saved prior-day draft after waiting for a save', async () => {
    const hook = renderHook((value) => useDailyPlanStore(value), { initialProps: input() });
    await advance(0);
    state.refetch.mockResolvedValue({ isSuccess: true, data: { ...day(draft), revision: 8 } });
    await act(async () => {
      await hook.result.current.reviewSavedDraft();
    });
    let finishSave: ((value: { revision: number }) => void) | undefined;
    state.save.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finishSave = done;
        }),
    );
    act(() => {
      void hook.result.current.persist(draft, 'plan', 0);
    });
    await advance(0);
    let applying: Promise<void> | undefined;
    act(() => {
      applying = hook.result.current.applySavedDraft();
    });
    const next = { ...draft, date: '2026-10-08', finishAt: '2026-10-08T17:00:00.000Z' };
    state.propose.mockResolvedValue(proposal(next));
    act(() => {
      hook.rerender({
        ...input(next),
        date: next.date,
        day: { ...day(next), date: next.date, revision: 20 },
      });
    });
    await advance(0);
    await act(async () => {
      finishSave?.({ revision: 6 });
      await applying;
    });
    expect(hook.result.current.draft).toEqual(next);
    expect(hook.result.current.serverRevision.current).toBe(20);
    expect(hook.result.current.savedDraftReview).toBeNull();
  });
});
