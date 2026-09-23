'use client';

/** State and mutations for the distinct daily planning flow. */
import type { DailyPlanSession, DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import { addDays, instantAt, localMinuteOfDay } from '@docket/planning/zoned-time';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useTimerControls, useTimerState } from '@/components/time-tracking/use-timer';
import { useAppSearchParams } from '@/lib/app-location';

import { type EventBlock } from './daily-planning-agenda';
import { capacityMinutes, placeSession } from './daily-planning-model';
import {
  useAvailableDailyWork,
  useApplyDailyReview,
  useCompleteReviewItem,
  useConfirmDailyPlan,
  useDailyPlanningDay,
  useRenameDailyTask,
  useSaveDailyDraft,
} from './daily-planning-queries';

/** The screens in the morning planning flow. */
export type Stage = 'yesterday' | 'plan' | 'add' | 'review' | 'confirmed';
/** One day returned by the planning read. */
export type DayData = NonNullable<ReturnType<typeof useDailyPlanningDay>['data']>;
/** One currently viewable task in a planning day. */
export type Task = DayData['tasks'][number];

function eventsFor(day: DayData): EventBlock[] {
  return day.agenda.entries.flatMap((entry) =>
    entry.kind === 'google_calendar_event' && entry.event.startsAt && entry.event.endsAt
      ? [{ title: entry.event.title, startsAt: entry.event.startsAt, endsAt: entry.event.endsAt }]
      : [],
  );
}

function initialDraft(date: string, timezone: string, day: DayData): DailyPlanSnapshot {
  if (day.draft) return day.draft;
  if (day.accepted) return day.accepted.current.snapshot;
  const tasks = day.tasks
    .filter((task) => task.completedAt === null)
    .map((task, sort) => ({
      taskId: task.taskId,
      organizationId: task.organizationId,
      plannedMinutes: 45,
      sort,
    }));
  const selected = new Set(tasks.map((task) => task.taskId));
  const sessions = day.agenda.entries.flatMap((entry) => {
    if (entry.kind !== 'task_timebox' || !selected.has(entry.taskId)) return [];
    const plannedMinutes = Math.min(
      45,
      Math.round((Date.parse(entry.endsAt) - Date.parse(entry.startsAt)) / 60_000),
    );
    return plannedMinutes > 0
      ? [
          {
            id: `legacy-${entry.taskId}`,
            startsAt: entry.startsAt,
            endsAt: entry.endsAt,
            allocations: [{ taskId: entry.taskId, plannedMinutes }],
            pinned: false,
          },
        ]
      : [];
  });
  return {
    date,
    finishAt: instantAt(date, 17 * 60, timezone).toISOString(),
    mainTaskId: null,
    tasks,
    sessions,
  };
}

function initialStage(day: DayData, previous: DayData): Stage {
  if (day.draft) {
    if (day.resumeStep === 'review_yesterday') return 'yesterday';
    return day.resumeStep === 'review_plan' ? 'review' : 'plan';
  }
  if (day.accepted) return 'plan';
  if (day.carryover.length > 0 || previous.tasks.length > 0 || previous.actual.length > 0)
    return 'yesterday';
  return day.tasks.some((task) => task.completedAt === null) ? 'plan' : 'add';
}

function planningDate(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : new Date().toLocaleDateString('en-CA');
}

function useDraftPersistence(date: string, draft: DailyPlanSnapshot | null, stage: Stage) {
  const save = useSaveDailyDraft(date);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [revision, setRevision] = useState(0);
  const [savedRevision, setSavedRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const persist = (
    value: DailyPlanSnapshot,
    nextStage: Stage,
    targetRevision: number,
  ): Promise<void> => {
    const resumeStep =
      nextStage === 'yesterday'
        ? 'review_yesterday'
        : nextStage === 'review'
          ? 'review_plan'
          : 'plan_today';
    const next = queue.current
      .catch(() => undefined)
      .then(() => save.mutateAsync({ draft: value, resumeStep }));
    queue.current = next;
    return next
      .then(() => {
        setSavedRevision((previous) => Math.max(previous, targetRevision));
        setError(null);
      })
      .catch(() => {
        setError('Your edits are still here. Save failed.');
        throw new Error('save failed');
      });
  };
  useEffect(() => {
    if (!draft || revision <= savedRevision || stage === 'confirmed') return;
    const timeout = setTimeout(() => {
      void persist(draft, stage, revision).catch(() => undefined);
    }, 700);
    return () => {
      clearTimeout(timeout);
    };
  }, [draft, revision, savedRevision, stage]);
  return { persist, revision, setRevision, error, setError };
}

function usePlanDraft(
  date: string,
  timezone: string,
  missedId: string | null,
  day?: DayData,
  previous?: DayData,
) {
  const [draft, setDraft] = useState<DailyPlanSnapshot | null>(null);
  const [stage, setStage] = useState<Stage>('plan');
  const initializedDate = useRef<string | null>(null);
  const persistence = useDraftPersistence(date, draft, stage);
  useEffect(() => {
    if (!day || !previous || initializedDate.current === date) return;
    initializedDate.current = date;
    const draft = initialDraft(date, timezone, day);
    const missed = day.accepted?.current.snapshot.sessions.find(
      (session) =>
        session.id === missedId && !session.pinned && Date.parse(session.endsAt) <= Date.now(),
    );
    setDraft(
      missed
        ? { ...draft, sessions: draft.sessions.filter((session) => session.id !== missed.id) }
        : draft,
    );
    setStage(missed ? 'review' : initialStage(day, previous));
  }, [date, day, previous, timezone, missedId]);
  const editDraft = (value: DailyPlanSnapshot): void => {
    setDraft(value);
    persistence.setRevision((count) => count + 1);
    persistence.setError(null);
  };
  const go = async (nextStage: Stage, value = draft): Promise<void> => {
    if (!value) return;
    try {
      await persistence.persist(value, nextStage, persistence.revision);
      setStage(nextStage);
      window.scrollTo(0, 0);
    } catch {
      /* The draft remains visible with Retry. */
    }
  };
  return { draft, stage, setStage, editDraft, go, ...persistence };
}

function removeSelectedTask(draft: DailyPlanSnapshot, taskId: string): DailyPlanSnapshot {
  return {
    ...draft,
    mainTaskId: draft.mainTaskId === taskId ? null : draft.mainTaskId,
    tasks: draft.tasks.filter((task) => task.taskId !== taskId),
    sessions: draft.sessions
      .map((session) => ({
        ...session,
        allocations: session.allocations.filter((part) => part.taskId !== taskId),
      }))
      .filter((session) => session.allocations.length > 0),
  };
}

function usePlanningTasks(input: {
  date: string;
  timezone: string;
  draft: DailyPlanSnapshot | null;
  editDraft: (value: DailyPlanSnapshot) => void;
  setError: (value: string | null) => void;
  fixed: readonly EventBlock[];
  startAt: string;
}) {
  const rename = useRenameDailyTask(input.date);
  const [taskNames, setTaskNames] = useState<Record<string, string>>({});
  const [failedTitle, setFailedTitle] = useState<{ taskId: string; title: string } | null>(null);
  const [editing, setEditing] = useState<{ taskId: string; sessionId?: string } | null>(null);
  const renameTask = async (
    task: Pick<Task, 'taskId' | 'organizationId'>,
    title: string,
  ): Promise<void> => {
    setTaskNames((current) => ({ ...current, [task.taskId]: title }));
    try {
      await rename.mutateAsync({ organizationId: task.organizationId, taskId: task.taskId, title });
      setFailedTitle(null);
    } catch {
      setFailedTitle({ taskId: task.taskId, title });
    }
  };
  const addTask = (taskId: string, organizationId: string, title: string): void => {
    const draft = input.draft;
    if (!draft || draft.tasks.some((task) => task.taskId === taskId)) return;
    setTaskNames((current) => ({ ...current, [taskId]: title }));
    input.editDraft({
      ...draft,
      tasks: [
        ...draft.tasks,
        { taskId, organizationId, plannedMinutes: 45, sort: draft.tasks.length },
      ],
    });
  };
  const removeTask = (taskId: string): void => {
    const draft = input.draft;
    if (!draft) return;
    input.editDraft(removeSelectedTask(draft, taskId));
  };
  const saveSession = (session: DailyPlanSession): void => {
    const draft = input.draft;
    if (!draft) return;
    try {
      if (
        !draft.sessions.some((item) => item.id === session.id) &&
        Date.parse(session.startsAt) < Date.parse(input.startAt)
      )
        throw new Error('Choose a time that has not passed.');
      input.editDraft(
        placeSession(
          draft,
          session,
          input.fixed,
          instantAt(input.date, 0, input.timezone).toISOString(),
        ),
      );
      setEditing(null);
    } catch {
      input.setError(
        'Choose a time within the workday that does not overlap another block or event. Check Planned time if the block is too long.',
      );
    }
  };
  return {
    taskNames,
    failedTitle,
    editing,
    setEditing,
    renameTask,
    addTask,
    removeTask,
    saveSession,
  };
}

function useReviewChoices(previousDate: string, date: string) {
  const [reviewChoices, setReviewChoices] = useState<
    Record<string, 'today' | 'backlog' | 'done' | 'another'>
  >({});
  const [reviewDates, setReviewDates] = useState<Record<string, string>>({});
  const completeReview = useCompleteReviewItem(previousDate, date);
  const applyReview = useApplyDailyReview(date);
  return {
    reviewChoices,
    setReviewChoices,
    reviewDates,
    setReviewDates,
    completeReview,
    applyReview,
  };
}

function usePlanUndo(
  store: ReturnType<typeof usePlanDraft>,
  confirm: ReturnType<typeof useConfirmDailyPlan>,
) {
  const [previousAccepted, setPreviousAccepted] = useState<DailyPlanSnapshot | null>(null);
  const undoAdjustment = async (): Promise<void> => {
    if (!previousAccepted) return;
    try {
      await store.persist(previousAccepted, 'review', store.revision);
      await confirm.mutateAsync(undefined);
      store.editDraft(previousAccepted);
      setPreviousAccepted(null);
      store.setError(null);
    } catch {
      store.setError('Could not restore the previous plan. Try again.');
    }
  };
  return { previousAccepted, setPreviousAccepted, undoAdjustment };
}

/** Hook backing the planning stages with one resumable draft. */
export function useDailyPlanningController() {
  const params = useAppSearchParams();
  const date = planningDate(params.get('date'));
  const previousDate = addDays(date, -1);
  const dayQ = useDailyPlanningDay(date);
  const previousQ = useDailyPlanningDay(previousDate);
  const timezone = dayQ.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const fixed = useMemo(() => (dayQ.data ? eventsFor(dayQ.data) : []), [dayQ.data]);
  const store = usePlanDraft(date, timezone, params.get('missed'), dayQ.data, previousQ.data);
  const allTasks = useMemo(
    () =>
      new Map(
        [...(dayQ.data?.tasks ?? []), ...(previousQ.data?.tasks ?? [])].map((task) => [
          task.taskId,
          task,
        ]),
      ),
    [dayQ.data?.tasks, previousQ.data?.tasks],
  );
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  const startMinute =
    date === today ? Math.max(9 * 60, localMinuteOfDay(new Date(), timezone)) : 9 * 60;
  const startAt = instantAt(date, startMinute, timezone).toISOString();
  const tasks = usePlanningTasks({
    date,
    timezone,
    draft: store.draft,
    editDraft: store.editDraft,
    setError: store.setError,
    fixed,
    startAt,
  });
  const [search, setSearch] = useState('');
  const review = useReviewChoices(previousDate, date);
  const [wasAdjustment, setWasAdjustment] = useState(false);
  const searchQ = useAvailableDailyWork(search, store.stage === 'add');
  const confirm = useConfirmDailyPlan(date);
  const undo = usePlanUndo(store, confirm);
  const timer = useTimerState();
  const timerControls = useTimerControls(timer.record?.id ?? null);
  const names = useMemo(
    () => new Map([...allTasks].map(([id, task]) => [id, tasks.taskNames[id] ?? task.title])),
    [allTasks, tasks.taskNames],
  );
  const titleFor = (taskId: string): string =>
    names.get(taskId) ?? tasks.taskNames[taskId] ?? 'Task';
  const capacity = store.draft ? capacityMinutes(startAt, store.draft.finishAt, fixed) : 0;
  const total = store.draft?.tasks.reduce((sum, task) => sum + task.plannedMinutes, 0) ?? 0;
  return {
    date,
    previousDate,
    dayQ,
    previousQ,
    timezone,
    fixed,
    startAt,
    allTasks,
    names,
    titleFor,
    capacity,
    total,
    search,
    setSearch,
    searchQ,
    confirm,
    timer,
    timerControls,
    wasAdjustment,
    setWasAdjustment,
    ...undo,
    ...review,
    ...store,
    ...tasks,
  };
}

/** A controller after all reads have loaded the editable draft. */
export type ReadyPlanningController = ReturnType<typeof useDailyPlanningController> & {
  draft: DailyPlanSnapshot;
};
