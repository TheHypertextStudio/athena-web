import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import type { DayData } from '../../src/components/daily-planning/daily-planning-controller';

const state = vi.hoisted(() => ({ propose: vi.fn() }));
vi.mock('../../src/components/daily-planning/daily-planning-queries', () => ({
  useSaveDailyDraft: () => ({ mutateAsync: vi.fn() }),
  useDailyPlanProposal: () => ({ mutateAsync: state.propose, isPending: false }),
  useDailyPlanningDay: () => ({ refetch: vi.fn() }),
}));
import { useDailyPlanStore } from '../../src/components/daily-planning/daily-planning-store';

const date = '2026-10-07';
const proposed: DailyPlanSnapshot = {
  date,
  finishAt: '2026-10-07T17:00:00.000Z',
  mainTaskId: 'created-task',
  tasks: [
    {
      taskId: 'created-task',
      organizationId: 'workspace',
      plannedMinutes: 60,
      sort: 0,
      selectionSource: 'suggested',
      durationSource: 'estimate',
    },
  ],
  sessions: [
    {
      id: 'proposal:created-task',
      startsAt: '2026-10-07T09:00:00.000Z',
      endsAt: '2026-10-07T10:00:00.000Z',
      allocations: [{ taskId: 'created-task', plannedMinutes: 60 }],
      pinned: false,
      placementSource: 'automatic',
    },
  ],
};
const emptyDay = (): DayData => ({
  date,
  draft: null,
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
const input = () => ({
  date,
  day: emptyDay(),
  previous: emptyDay(),
  missedId: null,
  recovery: null,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  state.propose.mockReset().mockResolvedValue({
    draft: proposed,
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
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('opens the first day with the proposed work and schedule already in the draft', async () => {
  const hook = renderHook(() => useDailyPlanStore(input()));

  await act(async () => {
    vi.advanceTimersByTime(0);
  });

  expect(hook.result.current.draft).toEqual(proposed);
  expect(hook.result.current.preview).toBeNull();
});
