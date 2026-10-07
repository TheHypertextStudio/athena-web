'use client';

/** Resumable draft state, guarded saves, and reversible schedule proposals. */
import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import {
  dailyAllocations,
  type DailyExecutionAllocation,
} from '@docket/planning/daily-plan-execution';
import { instantAt } from '@docket/planning/zoned-time';
import { useEffect, useMemo, useRef, useState } from 'react';
import { UserFacingError } from '@/lib/problem';
import { capacityMinutes } from './daily-planning-model';
import { useGuardedPersistence } from './daily-planning-persistence';
import type { DayData, Stage } from './daily-planning-controller';
import { useDailyPlanningDay, useDailyPlanProposal } from './daily-planning-queries';

type Proposal = Awaited<ReturnType<ReturnType<typeof useDailyPlanProposal>['mutateAsync']>>;

/** A schedule shown on the agenda before the person applies it. */
export interface SchedulePreview {
  readonly draft: DailyPlanSnapshot;
  readonly title: string;
  readonly proposal?: Proposal;
}

interface StoreInput {
  readonly date: string;
  readonly day?: DayData | undefined;
  readonly previous?: DayData | undefined;
  readonly missedId: string | null;
  readonly recovery: string | null;
  readonly recoveryTaskId?: string | null;
}

function resumeStage(day: DayData, previous: DayData): Stage {
  if (day.draft)
    return day.resumeStep === 'review_yesterday'
      ? 'yesterday'
      : day.resumeStep === 'review_plan'
        ? 'review'
        : 'plan';
  if (day.accepted) return 'plan';
  return day.carryover.length || previous.tasks.length || previous.actual.length
    ? 'yesterday'
    : 'plan';
}

function usePlanState(date: string) {
  const [draft, setDraft] = useState<DailyPlanSnapshot | null>(null);
  const [stage, setStage] = useState<Stage>('plan');
  const [revision, setRevision] = useState(0);
  const [scheduleRevision, setScheduleRevision] = useState(0);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [proposalContext, setProposalContext] = useState<Proposal | null>(null);
  const [undoDraft, setUndoDraft] = useState<DailyPlanSnapshot | null>(null);
  const generation = useRef(0);
  const savedRevision = useRef(0);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stageTransition = useRef(false);
  const dateEntry = useMemo(() => ({ date }), [date]);
  const currentDate = useRef(dateEntry);
  useEffect(() => {
    if (currentDate.current === dateEntry) return;
    currentDate.current = dateEntry;
    generation.current += 1;
    stageTransition.current = false;
    clearTimeout(autosaveTimer.current);
  }, [dateEntry]);
  // Returning to the same date must not revive operations from its previous visit.
  const isCurrentDate = (): boolean => currentDate.current === dateEntry;
  return {
    isCurrentDate,
    draft,
    setDraft,
    stage,
    setStage,
    revision,
    setRevision,
    scheduleRevision,
    setScheduleRevision,
    preview,
    setPreview,
    proposalContext,
    setProposalContext,
    undoDraft,
    setUndoDraft,
    generation,
    savedRevision,
    autosaveTimer,
    stageTransition,
  };
}

type PlanState = ReturnType<typeof usePlanState>;
type Persistence = ReturnType<typeof useGuardedPersistence>;
type Propose = (value?: DailyPlanSnapshot) => Promise<Proposal>;

function remainingAllocation(
  allocation: DailyExecutionAllocation,
  day: DayData | undefined,
): number {
  const actual =
    day?.actual
      .filter((entry) => entry.taskId === allocation.taskId)
      .map((entry) => ({
        startsAt: entry.startedAt,
        endsAt: entry.endedAt ?? new Date().toISOString(),
      })) ?? [];
  return capacityMinutes(allocation.startsAt, allocation.endsAt, actual) || 15;
}

function continuingDraft(
  source: DailyPlanSnapshot,
  allocation: DailyExecutionAllocation,
  minutes: number,
): DailyPlanSnapshot {
  const startsAt = Math.ceil(Date.now() / 60_000) * 60_000;
  const id = `continuation:${allocation.sessionId}:${allocation.taskId}`;
  const sessions = [
    ...source.sessions.filter((session) => session.id !== id),
    {
      id,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(startsAt + minutes * 60_000).toISOString(),
      allocations: [{ taskId: allocation.taskId, plannedMinutes: minutes }],
      pinned: false,
      placementSource: 'manual' as const,
    },
  ];
  const allocated = sessions
    .flatMap((session) => session.allocations)
    .filter((entry) => entry.taskId === allocation.taskId)
    .reduce((total, entry) => total + entry.plannedMinutes, 0);
  return {
    ...source,
    sessions,
    tasks: source.tasks.map((entry) =>
      entry.taskId === allocation.taskId
        ? {
            ...entry,
            plannedMinutes: Math.max(entry.plannedMinutes, allocated),
            durationSource: 'edited' as const,
          }
        : entry,
    ),
  };
}

function recoverySource(
  saved: DailyPlanSnapshot | null | undefined,
  input: StoreInput,
): DailyPlanSnapshot | undefined {
  if (!saved) return undefined;
  const missed = saved.sessions.find((session) => session.id === input.missedId);
  if (!missed || !input.recovery) return saved;
  const source = {
    ...saved,
    sessions: saved.sessions.filter((session) => session.id !== missed.id || session.pinned),
  };
  if (input.recovery !== 'still_working') return source;
  const allocations = dailyAllocations([missed]);
  const allocation = input.recoveryTaskId
    ? allocations.find((entry) => entry.taskId === input.recoveryTaskId)
    : allocations[0];
  if (!allocation) return source;
  return continuingDraft(source, allocation, remainingAllocation(allocation, input.day));
}

function applyInitialProposal(
  state: PlanState,
  result: Proposal,
  saved: DailyPlanSnapshot | null | undefined,
  recovery: string | null,
): void {
  state.setProposalContext(result);
  if (!saved) {
    state.setDraft(result.draft);
    state.setRevision((value) => value + 1);
    return;
  }
  const changed = scheduleChanged(result.draft, saved);
  if (!recovery && !changed) return;
  state.setPreview({
    draft: result.draft,
    title: recovery ? 'Changes to the rest of today' : 'Proposed schedule',
    proposal: result,
  });
}

function schedulingIntent(snapshot: DailyPlanSnapshot): unknown {
  return {
    sessions: snapshot.sessions,
    tasks: snapshot.tasks.map(({ taskId, organizationId, plannedMinutes, sort }) => ({
      taskId,
      organizationId,
      plannedMinutes,
      sort,
    })),
  };
}

function scheduleChanged(left: DailyPlanSnapshot, right: DailyPlanSnapshot): boolean {
  return JSON.stringify(schedulingIntent(left)) !== JSON.stringify(schedulingIntent(right));
}

function initializeDraft(input: StoreInput, state: PlanState) {
  if (!input.day || !input.previous) return undefined;
  state.savedRevision.current = 0;
  state.setRevision(0);
  state.setScheduleRevision(0);
  state.setPreview(null);
  state.setProposalContext(null);
  state.setUndoDraft(null);
  const saved = input.day.draft ?? input.day.accepted?.current.snapshot;
  state.setDraft(saved ?? null);
  state.setStage(input.recovery ? 'review' : resumeStage(input.day, input.previous));
  return saved;
}

function useInitialProposal(
  input: StoreInput,
  state: PlanState,
  persistence: Persistence,
  propose: Propose,
) {
  const initialDate = useRef<string | null>(null);
  const load = async (): Promise<void> => {
    if (!input.day || !input.previous) return;
    const firstLoad = initialDate.current !== input.date;
    initialDate.current = input.date;
    const token = ++state.generation.current;
    const saved = firstLoad ? initializeDraft(input, state) : state.draft;
    const source = firstLoad ? recoverySource(saved, input) : (saved ?? undefined);
    try {
      const result = await propose(source);
      if (token !== state.generation.current) return;
      persistence.setError(null);
      applyInitialProposal(state, result, saved, firstLoad ? input.recovery : null);
    } catch {
      if (token === state.generation.current)
        persistence.setError('Could not organize this day. Try again.');
    }
  };
  useEffect(() => {
    if (!input.day || !input.previous || initialDate.current === input.date) return;
    void load();
  }, [input.day, input.previous, input.date]);
  return { retryInitialProposal: load };
}

function useStageTransition(
  state: PlanState,
  persistence: Persistence,
  editDraft: (draft: DailyPlanSnapshot) => void,
) {
  const go = async (next: Stage, value = state.draft): Promise<void> => {
    if (!state.isCurrentDate() || !value || state.stageTransition.current) return;
    state.stageTransition.current = true;
    clearTimeout(state.autosaveTimer.current);
    persistence.invalidateQueuedSaves();
    try {
      await persistence.persist(value, next, state.revision);
      if (!state.isCurrentDate()) return;
      state.savedRevision.current = state.revision;
      if (value !== state.draft) editDraft(value);
      state.setStage(next);
      window.scrollTo(0, 0);
    } catch {
      /* The visible draft remains editable. */
    } finally {
      if (state.isCurrentDate()) state.stageTransition.current = false;
    }
  };
  return go;
}

function useDraftActions(state: PlanState, persistence: Persistence, propose: Propose) {
  const editDraft = (value: DailyPlanSnapshot): void => {
    if (!state.isCurrentDate()) return;
    state.generation.current += 1;
    state.setDraft(value);
    state.setPreview(null);
    state.setRevision((count) => count + 1);
    state.setScheduleRevision((count) => count + 1);
    if (!persistence.conflict) persistence.setError(null);
  };
  const rebuild = async (value = state.draft): Promise<void> => {
    if (!value) return;
    const token = ++state.generation.current;
    try {
      const result = await propose(value);
      if (token !== state.generation.current) return;
      state.setProposalContext(result);
      if (scheduleChanged(result.draft, value))
        state.setPreview({ draft: result.draft, title: 'Proposed schedule', proposal: result });
    } catch (failure) {
      if (
        token === state.generation.current &&
        !persistence.conflict &&
        !(failure instanceof UserFacingError && failure.status === 409)
      )
        persistence.setError('Could not reorganize this day. Your current plan is still here.');
    }
  };
  const applyPreview = (): void => {
    if (!state.preview || !state.draft) return;
    state.generation.current += 1;
    state.setUndoDraft(state.draft);
    state.setDraft(state.preview.draft);
    if (state.preview.proposal) state.setProposalContext(state.preview.proposal);
    state.setPreview(null);
    state.setRevision((count) => count + 1);
    state.setScheduleRevision(0);
  };
  const undoSchedule = (): void => {
    if (!state.undoDraft) return;
    state.generation.current += 1;
    state.setDraft(state.undoDraft);
    state.setUndoDraft(null);
    state.setPreview(null);
    state.setRevision((count) => count + 1);
    state.setScheduleRevision(0);
  };
  const go = useStageTransition(state, persistence, editDraft);
  useEffect(() => {
    if (!state.scheduleRevision || !state.draft || state.stage === 'confirmed') return;
    const timer = setTimeout(() => {
      void rebuild(state.draft);
    }, 900);
    return () => {
      clearTimeout(timer);
    };
  }, [state.scheduleRevision, state.stage]);
  return {
    editDraft,
    rebuild,
    applyPreview,
    undoSchedule,
    go,
    canUndoSchedule: Boolean(state.undoDraft),
  };
}

function useConflictRecovery(input: StoreInput, state: PlanState, persistence: Persistence) {
  const { refetch } = useDailyPlanningDay(input.date, false);
  const [savedDraftReview, setSavedDraftReview] = useState<{
    draft: DailyPlanSnapshot;
    revision: number;
    resumeStep: DayData['resumeStep'];
  } | null>(null);
  useEffect(() => {
    setSavedDraftReview(null);
  }, [input.date]);
  const reviewSavedDraft = async (): Promise<void> => {
    const result = await refetch();
    if (!state.isCurrentDate()) return;
    const saved = result.data?.draft ?? result.data?.accepted?.current.snapshot;
    if (!result.isSuccess || !saved) {
      persistence.setError('Could not load a saved plan. Your edits are still here.');
      return;
    }
    setSavedDraftReview({
      draft: saved,
      revision: result.data.revision,
      resumeStep: result.data.resumeStep,
    });
  };
  const applySavedDraft = async (): Promise<void> => {
    if (!state.isCurrentDate() || !savedDraftReview) return;
    state.generation.current += 1;
    await persistence.acceptServerRevision(savedDraftReview.revision);
    if (!state.isCurrentDate()) return;
    state.savedRevision.current = state.revision + 1;
    state.setDraft(savedDraftReview.draft);
    state.setRevision((value) => value + 1);
    state.setScheduleRevision((value) => value + 1);
    state.setPreview(null);
    state.setUndoDraft(null);
    state.setProposalContext(null);
    state.setStage(savedDraftReview.resumeStep === 'review_plan' ? 'review' : 'plan');
    setSavedDraftReview(null);
  };
  return {
    savedDraftReview,
    reviewSavedDraft,
    applySavedDraft,
    dismissSavedDraft: () => {
      setSavedDraftReview(null);
    },
  };
}

/** Keep the current draft separate from proposed schedules and explicitly reviewed saved state. */
export function useDailyPlanStore(input: StoreInput) {
  const state = usePlanState(input.date);
  const proposal = useDailyPlanProposal(input.date);
  const persistence = useGuardedPersistence(input.date, input.day?.revision);
  const propose: Propose = async (value) => {
    await persistence.flush();
    if (!state.isCurrentDate()) throw new Error('Planning date changed');
    if (value && state.revision > state.savedRevision.current) {
      await persistence.persist(value, state.stage, state.revision);
      if (!state.isCurrentDate()) throw new Error('Planning date changed');
      state.savedRevision.current = state.revision;
    }
    return proposal.mutateAsync({
      ...(value ? { draft: value } : {}),
      expectedRevision: persistence.serverRevision.current,
    });
  };
  const initial = useInitialProposal(input, state, persistence, propose);
  const actions = useDraftActions(state, persistence, propose);
  const recovery = useConflictRecovery(input, state, persistence);
  useEffect(() => {
    const currentDraft = state.draft;
    if (
      !currentDraft ||
      state.revision <= state.savedRevision.current ||
      state.stage === 'confirmed'
    )
      return;
    const timer = setTimeout(() => {
      if (state.stageTransition.current) return;
      void persistence
        .persist(currentDraft, state.stage, state.revision)
        .then(() => {
          if (state.isCurrentDate()) state.savedRevision.current = state.revision;
        })
        .catch(() => undefined);
    }, 700);
    state.autosaveTimer.current = timer;
    return () => {
      clearTimeout(timer);
    };
  }, [state.draft, state.revision, state.stage]);
  const planningStartAt =
    state.draft?.settings?.startAt ??
    state.proposalContext?.startAt ??
    instantAt(input.date, 540, input.day?.timezone ?? 'UTC').toISOString();
  const setStage = (next: Stage): void => {
    if (!state.isCurrentDate()) return;
    if (next === 'confirmed') {
      state.generation.current += 1;
      state.setPreview(null);
    }
    state.setStage(next);
  };
  return {
    ...state,
    ...actions,
    ...initial,
    ...recovery,
    ...persistence,
    setStage,
    planningStartAt,
    proposalPending: proposal.isPending,
  };
}
