import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import type { DayData } from '../../src/components/daily-planning/daily-planning-controller';
import { UserFacingError } from '../../src/lib/problem';

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

describe('guarded planner persistence and recovery', () => {
  it('saves the latest edits before a proposal uses the server revision', async () => {
    const hook = renderHook(() => useDailyPlanStore(input()));
    const edited = { ...draft, finishAt: '2026-10-07T18:00:00.000Z' };
    act(() => {
      hook.result.current.editDraft(edited);
    });
    await act(async () => {
      await hook.result.current.rebuild();
    });
    expect(state.save).toHaveBeenCalledWith(
      expect.objectContaining({ draft: edited, expectedRevision: 5 }),
    );
    expect(state.propose).toHaveBeenCalledWith(
      expect.objectContaining({ draft: edited, expectedRevision: 6 }),
    );
  });

  it('does not apply an in-flight proposal after another edit', async () => {
    let resolve: ((value: unknown) => void) | undefined;
    state.propose.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const hook = renderHook(() => useDailyPlanStore(input()));
    act(() => {
      void hook.result.current.rebuild();
    });
    await advance(0);
    const edited = { ...draft, finishAt: '2026-10-07T18:00:00.000Z' };
    act(() => {
      hook.result.current.editDraft(edited);
    });
    await act(async () => {
      resolve?.(
        proposal({
          ...draft,
          sessions: [
            {
              id: 'stale',
              startsAt: '2026-10-07T09:00:00.000Z',
              endsAt: '2026-10-07T10:00:00.000Z',
              allocations: [],
              pinned: false,
            },
          ],
        }),
      );
    });
    expect(hook.result.current.preview).toBeNull();
    expect(hook.result.current.draft).toEqual(edited);
  });

  it('can retry an initial proposal failure', async () => {
    state.propose.mockRejectedValueOnce(new Error('unavailable'));
    const hook = renderHook(() => useDailyPlanStore(input(null)));
    await advance(0);
    expect(hook.result.current.draft).toBeNull();
    await act(async () => {
      await hook.result.current.retryInitialProposal();
    });
    expect(hook.result.current.draft).toEqual(draft);
  });

  it('keeps local edits and the chosen stage when retrying saved-plan context', async () => {
    state.propose.mockRejectedValueOnce(new Error('unavailable'));
    const hook = renderHook(() => useDailyPlanStore(input()));
    await advance(0);
    const edited = { ...draft, finishAt: '2026-10-07T18:00:00.000Z' };
    act(() => {
      hook.result.current.editDraft(edited);
      hook.result.current.setStage('review');
    });
    state.propose.mockResolvedValue(proposal(edited));
    await act(async () => {
      await hook.result.current.retryInitialProposal();
    });
    expect(hook.result.current.draft).toEqual(edited);
    expect(hook.result.current.stage).toBe('review');
    expect(state.propose).toHaveBeenLastCalledWith(
      expect.objectContaining({ draft: edited, expectedRevision: 6 }),
    );
    expect(hook.result.current.preview).toBeNull();
  });

  it('keeps local edits while reviewing a conflict and loads saved state only after selection', async () => {
    state.save.mockRejectedValueOnce(new UserFacingError('Conflict', { status: 409 }));
    const saved = { ...draft, finishAt: '2026-10-07T16:00:00.000Z' };
    state.refetch.mockResolvedValue({ data: { ...day(saved), revision: 8 }, isSuccess: true });
    const hook = renderHook(() => useDailyPlanStore(input()));
    const edited = { ...draft, finishAt: '2026-10-07T18:00:00.000Z' };
    act(() => {
      hook.result.current.editDraft(edited);
    });
    await advance(700);
    await act(async () => {
      await hook.result.current.reviewSavedDraft();
    });
    expect(hook.result.current.draft).toEqual(edited);
    expect(hook.result.current.savedDraftReview?.draft).toEqual(saved);
    await act(async () => {
      await hook.result.current.applySavedDraft();
    });
    expect(hook.result.current.draft).toEqual(saved);
    expect(hook.result.current.serverRevision.current).toBe(8);
    await advance(900);
    expect(state.propose).toHaveBeenLastCalledWith(
      expect.objectContaining({ draft: saved, expectedRevision: 8 }),
    );
    expect(state.save).toHaveBeenCalledTimes(1);
  });

  it('waits for an in-flight autosave before requesting a new schedule', async () => {
    let finishSave: ((value: { revision: number }) => void) | undefined;
    state.save.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        }),
    );
    const hook = renderHook(() => useDailyPlanStore(input()));
    await advance(0);
    state.propose.mockClear();
    act(() => {
      hook.result.current.editDraft({ ...draft, finishAt: '2026-10-07T18:00:00.000Z' });
    });
    await advance(700);
    act(() => {
      void hook.result.current.rebuild();
    });
    await advance(0);
    expect(state.propose).not.toHaveBeenCalled();
    await act(async () => {
      finishSave?.({ revision: 9 });
    });
    expect(state.save).toHaveBeenCalledTimes(1);
    expect(state.propose).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 9 }));
  });

  it('cancels automatic rebuild when the plan is confirmed', async () => {
    const hook = renderHook(() => useDailyPlanStore(input()));
    await advance(0);
    state.propose.mockClear();
    act(() => {
      hook.result.current.editDraft({ ...draft, finishAt: '2026-10-07T18:00:00.000Z' });
    });
    act(() => {
      hook.result.current.setStage('confirmed');
    });
    await advance(2000);
    expect(state.propose).not.toHaveBeenCalled();
  });

  it('cannot overwrite a requested resume stage with a delayed autosave', async () => {
    let finishSave: ((value: { revision: number }) => void) | undefined;
    state.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        }),
    );
    const hook = renderHook(() => useDailyPlanStore(input(null)));
    await advance(0);
    let transition: Promise<void> | undefined;
    act(() => {
      transition = hook.result.current.go('review');
    });
    await advance(700);
    await act(async () => {
      finishSave?.({ revision: 6 });
      await transition;
    });
    await advance(1000);
    expect(hook.result.current.stage).toBe('review');
    expect(state.save).toHaveBeenCalledTimes(1);
    expect(state.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ resumeStep: 'review_plan' }),
    );
  });

  it('discards queued old-stage saves after an already-started save finishes', async () => {
    let finishSave: ((value: { revision: number }) => void) | undefined;
    state.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        }),
    );
    const hook = renderHook(() => useDailyPlanStore(input(null)));
    await advance(0);
    await advance(700);
    let transition: Promise<void> | undefined;
    act(() => {
      void hook.result.current.persist(draft, 'plan', hook.result.current.revision);
      transition = hook.result.current.go('review');
    });
    await act(async () => {
      finishSave?.({ revision: 6 });
      await transition;
    });
    expect(state.save).toHaveBeenCalledTimes(2);
    expect(state.save.mock.calls.map(([value]) => value.resumeStep)).toEqual([
      'plan_today',
      'review_plan',
    ]);
  });

  it('rejects a recovery response after confirmation', async () => {
    let resolve: ((value: unknown) => void) | undefined;
    state.propose.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const hook = renderHook(() => useDailyPlanStore({ ...input(), recovery: 'not_started' }));
    await advance(0);
    expect(hook.result.current.stage).toBe('review');
    act(() => {
      hook.result.current.setStage('confirmed');
    });
    await act(async () => {
      resolve?.(proposal());
    });
    expect(hook.result.current.stage).toBe('confirmed');
    expect(hook.result.current.preview).toBeNull();
  });

  it('uses the requested future day for resumed planning bounds', () => {
    const hook = renderHook(() => useDailyPlanStore(input()));
    expect(hook.result.current.planningStartAt).toBe('2026-10-07T09:00:00.000Z');
  });

  it('refreshes saved-plan context without replacing the saved draft', async () => {
    const suggested = {
      ...draft,
      tasks: [{ taskId: 'suggested', organizationId: 'org', plannedMinutes: 30, sort: 0 }],
    };
    state.propose.mockResolvedValue(proposal(suggested));
    const hook = renderHook(() => useDailyPlanStore(input()));
    await advance(0);
    expect(hook.result.current.draft).toEqual(draft);
    expect(hook.result.current.proposalContext?.startAt).toBe('2026-10-07T09:00:00.000Z');
    expect(hook.result.current.preview?.draft).toEqual(suggested);
  });

  it('does not demand a preview decision for duration provenance alone', async () => {
    const saved = {
      ...draft,
      tasks: [
        {
          taskId: 'work',
          organizationId: 'org',
          plannedMinutes: 30,
          sort: 0,
          durationSource: 'edited' as const,
        },
      ],
    };
    state.propose.mockResolvedValue(
      proposal({
        ...saved,
        tasks: saved.tasks.map((task) => ({ ...task, durationSource: 'default' as const })),
      }),
    );
    const hook = renderHook(() => useDailyPlanStore(input(saved)));
    await advance(0);
    expect(hook.result.current.preview).toBeNull();
    expect(hook.result.current.draft).toEqual(saved);
  });

  it('keeps an edited workday start ahead of older proposal context', async () => {
    const hook = renderHook(() => useDailyPlanStore(input()));
    await advance(0);
    act(() => {
      hook.result.current.editDraft({
        ...draft,
        settings: { startAt: '2026-10-07T10:00:00.000Z' },
      });
    });
    expect(hook.result.current.planningStartAt).toBe('2026-10-07T10:00:00.000Z');
  });

  it('rejects initial context that arrives after an edit', async () => {
    let resolve: ((value: unknown) => void) | undefined;
    state.propose.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const hook = renderHook(() => useDailyPlanStore(input()));
    await advance(0);
    const edited = { ...draft, finishAt: '2026-10-07T19:00:00.000Z' };
    act(() => {
      hook.result.current.editDraft(edited);
    });
    await act(async () => {
      resolve?.(proposal());
    });
    expect(hook.result.current.draft).toEqual(edited);
    expect(hook.result.current.proposalContext).toBeNull();
    expect(hook.result.current.preview).toBeNull();
  });

  it('continues still-working work at the current minute while not-started work stays flexible', async () => {
    vi.setSystemTime(new Date('2026-10-07T10:12:30.000Z'));
    const saved = {
      ...draft,
      tasks: [{ taskId: 'work', organizationId: 'org', plannedMinutes: 30, sort: 0 }],
      sessions: [
        {
          id: 'missed',
          startsAt: '2026-10-07T09:00:00.000Z',
          endsAt: '2026-10-07T09:30:00.000Z',
          allocations: [{ taskId: 'work', plannedMinutes: 30 }],
          pinned: false,
          placementSource: 'automatic' as const,
        },
      ],
    };
    const data = {
      ...day(saved),
      actual: [
        {
          taskId: 'work',
          startedAt: '2026-10-07T09:00:00.000Z',
          endedAt: '2026-10-07T09:10:00.000Z',
          recordedMinutes: 10,
        },
      ],
    };
    const current = {
      ...input(saved),
      day: data,
      missedId: 'missed',
      recovery: 'still_working',
      recoveryTaskId: 'work',
    };
    const hook = renderHook(() => useDailyPlanStore(current));
    await advance(0);
    expect(state.propose).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({
          sessions: [
            expect.objectContaining({
              placementSource: 'manual',
              startsAt: '2026-10-07T10:13:00.000Z',
              endsAt: '2026-10-07T10:33:00.000Z',
              allocations: [{ taskId: 'work', plannedMinutes: 20 }],
            }),
          ],
        }),
      }),
    );
    hook.unmount();
    state.propose.mockClear();
    renderHook(() => useDailyPlanStore({ ...current, recovery: 'not_started' }));
    await advance(0);
    expect(state.propose).toHaveBeenCalledWith(
      expect.objectContaining({ draft: expect.objectContaining({ sessions: [] }) }),
    );
  });

  it('keeps a pinned missed block and proposes editable continuation when the recorded allocation is exhausted', async () => {
    vi.setSystemTime(new Date('2026-10-07T10:00:00.000Z'));
    const saved = {
      ...draft,
      tasks: [{ taskId: 'work', organizationId: 'org', plannedMinutes: 30, sort: 0 }],
      sessions: [
        {
          id: 'pinned',
          startsAt: '2026-10-07T09:00:00.000Z',
          endsAt: '2026-10-07T09:30:00.000Z',
          allocations: [{ taskId: 'work', plannedMinutes: 30 }],
          pinned: true,
        },
      ],
    };
    const data = {
      ...day(saved),
      actual: [
        {
          taskId: 'work',
          startedAt: '2026-10-07T09:00:00.000Z',
          endedAt: '2026-10-07T09:30:00.000Z',
          recordedMinutes: 30,
        },
      ],
    };
    renderHook(() =>
      useDailyPlanStore({
        ...input(saved),
        day: data,
        missedId: 'pinned',
        recovery: 'still_working',
        recoveryTaskId: 'work',
      }),
    );
    await advance(0);
    expect(state.propose).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({
          sessions: [
            saved.sessions[0],
            expect.objectContaining({
              placementSource: 'manual',
              allocations: [{ taskId: 'work', plannedMinutes: 15 }],
            }),
          ],
          tasks: [
            expect.objectContaining({
              taskId: 'work',
              plannedMinutes: 45,
              durationSource: 'edited',
            }),
          ],
        }),
      }),
    );
  });
});
