'use client';

/** Compose one shared planning draft, task state, and execution controls. */
import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import type { CalendarEventOut } from '@docket/planning/calendar-contract';
import { addDays, instantAt } from '@docket/planning/zoned-time';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTimerControls, useTimerState } from '@/components/time-tracking/use-timer';
import { useAppSearchParams } from '@/lib/app-location';
import type { EventBlock } from './daily-planning-agenda';
import { useDailyPlanStore } from './daily-planning-store';
import { usePlanningTimezoneSetup } from './daily-planning-timezone';
import { useDailyPlanningTasks } from './daily-planning-task-state';
import { useDailyPlanningMove } from './daily-planning-move';
import {
  useAvailableDailyWork,
  useApplyDailyReview,
  useCompleteReviewItem,
  useConfirmDailyPlan,
  useDailyPlanningDay,
  useDailyPlanningPreferences,
  type DailyWorkScope,
} from './daily-planning-queries';

/** The screens in the focused daily flow. */
export type Stage = 'yesterday' | 'plan' | 'add' | 'review' | 'confirmed';
/** Visible data for one personal planning day. */
export type DayData = NonNullable<ReturnType<typeof useDailyPlanningDay>['data']>;
/** A currently viewable task in a planning day. */
export type Task = DayData['tasks'][number];

function calendarEventForDay(event: CalendarEventOut, day: DayData): EventBlock | null {
  const context = { id: event.id, title: event.title, blocksTime: event.blocksTime };
  if (event.startsAt && event.endsAt)
    return { ...context, startsAt: event.startsAt, endsAt: event.endsAt };
  if (
    !event.allDayStartDate ||
    !event.allDayEndDate ||
    event.allDayStartDate > day.date ||
    event.allDayEndDate <= day.date
  )
    return null;
  return {
    ...context,
    allDay: true,
    startsAt: instantAt(day.date, 0, day.timezone).toISOString(),
    endsAt: instantAt(addDays(day.date, 1), 0, day.timezone).toISOString(),
  };
}

function eventsFor(day: DayData): EventBlock[] {
  return [
    ...day.fixedIntervals.map((value) => ({
      id: value.kind === 'event' ? value.id : undefined,
      title: value.title,
      startsAt: value.startsAt,
      endsAt: value.endsAt,
      allDay: value.allDay,
      blocksTime: value.blocksTime,
    })),
    ...day.agenda.entries.flatMap((entry) => {
      if (entry.kind !== 'google_calendar_event') return [];
      const event = calendarEventForDay(entry.event, day);
      return event ? [event] : [];
    }),
  ];
}

function useFixedEvents(
  day: DayData | undefined,
  ignoredAllDay: readonly string[] | undefined,
): EventBlock[] {
  return useMemo(
    () =>
      (day ? eventsFor(day) : []).map((event) => ({
        ...event,
        calendarBlocksTime: event.blocksTime !== false,
        blocksTime:
          event.allDay && event.id && ignoredAllDay?.includes(event.id) ? false : event.blocksTime,
      })),
    [day, ignoredAllDay],
  );
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
  store: ReturnType<typeof useDailyPlanStore>,
  confirm: ReturnType<typeof useConfirmDailyPlan>,
) {
  const [previousAccepted, setPreviousAccepted] = useState<DailyPlanSnapshot | null>(null);
  const undoAdjustment = async (): Promise<void> => {
    if (!previousAccepted) return;
    try {
      await store.persist(previousAccepted, 'review', store.revision);
      if (!store.isCurrentDate()) return;
      const restored = await confirm.mutateAsync({
        expectedRevision: store.serverRevision.current,
      });
      if (!store.isCurrentDate()) return;
      store.serverRevision.current = restored.revision;
      store.editDraft(previousAccepted);
      setPreviousAccepted(null);
      store.setError(null);
    } catch {
      if (store.isCurrentDate()) store.setError('Could not restore the previous plan. Try again.');
    }
  };
  return { previousAccepted, setPreviousAccepted, undoAdjustment };
}

function remainingDayStart(date: string, timezone: string, startAt: string): string {
  if (date !== new Date().toLocaleDateString('en-CA', { timeZone: timezone })) return startAt;
  return new Date(
    Math.max(Date.parse(startAt), Math.ceil(Date.now() / 60_000) * 60_000),
  ).toISOString();
}

function usePlanningCatalog(
  day: DayData | undefined,
  previous: DayData | undefined,
  proposal: ReturnType<typeof useDailyPlanStore>['proposalContext'],
) {
  return useMemo(() => {
    const known = new Map<string, Task>(
      [...(day?.tasks ?? []), ...(previous?.tasks ?? [])].map((task) => [task.taskId, task]),
    );
    for (const item of proposal?.tasks ?? []) {
      if (!known.has(item.taskId))
        known.set(item.taskId, {
          taskId: item.taskId,
          organizationId: item.organizationId,
          title: item.title,
          projectId: item.projectId ?? null,
          projectName: item.projectName ?? null,
          completedAt: null,
          state: 'open',
          planItemId: null,
        });
    }
    return known;
  }, [day?.tasks, previous?.tasks, proposal]);
}

function requestedPlanningDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function useRequestedTaskEditor(input: {
  readonly date: string;
  readonly taskId: string | null;
  readonly recovery: string | null;
  readonly draft: DailyPlanSnapshot | null;
  readonly setEditing: ReturnType<typeof useDailyPlanningTasks>['setEditing'];
}): void {
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!input.taskId || input.recovery || input.draft?.date !== input.date) return;
    const key = `${input.date}:${input.taskId}`;
    if (opened.current === key || !input.draft.tasks.some((task) => task.taskId === input.taskId))
      return;
    const session = input.draft.sessions.find(
      (value) =>
        Date.parse(value.endsAt) > Date.now() &&
        value.allocations.some((part) => part.taskId === input.taskId),
    );
    opened.current = key;
    input.setEditing({ taskId: input.taskId, ...(session ? { sessionId: session.id } : {}) });
  }, [input.date, input.taskId, input.recovery, input.draft, input.setEditing]);
}

function usePlanningDate() {
  const params = useAppSearchParams();
  const preferences = useDailyPlanningPreferences();
  const requested = requestedPlanningDate(params.get('date'));
  const timezoneSetup = usePlanningTimezoneSetup(preferences.data?.timezone, preferences.isSuccess);
  const preferredTimezone =
    preferences.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = requested ?? new Date().toLocaleDateString('en-CA', { timeZone: preferredTimezone });
  const dateReady = preferences.isSuccess && timezoneSetup.ready;
  return {
    params,
    date,
    dateReady,
    preferredTimezone,
    preferencesError: preferences.isError || timezoneSetup.isError,
    retryPreferences: (): void => {
      if (timezoneSetup.isError) timezoneSetup.retry();
      else void preferences.refetch();
    },
  };
}

function useRequestedDayReview(input: {
  readonly requested: boolean;
  readonly date: string;
  readonly draft: DailyPlanSnapshot | null;
  readonly setStage: (stage: Stage) => void;
}): void {
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!input.requested || input.draft?.date !== input.date || opened.current === input.date)
      return;
    opened.current = input.date;
    input.setStage('yesterday');
  }, [input.requested, input.date, input.draft, input.setStage]);
}

function readyDay(day: DayData | undefined, ready: boolean, timezone: string): DayData | undefined {
  return ready && day?.timezone === timezone ? day : undefined;
}

function usePlanningDraft() {
  const { params, date, dateReady, preferredTimezone, preferencesError, retryPreferences } =
    usePlanningDate();
  const previousDate = addDays(date, -1);
  const dayQ = useDailyPlanningDay(date, dateReady);
  const previousQ = useDailyPlanningDay(previousDate, dateReady);
  const timezone = dayQ.data?.timezone ?? preferredTimezone;
  const store = useDailyPlanStore({
    date,
    day: readyDay(dayQ.data, dateReady, preferredTimezone),
    previous: readyDay(previousQ.data, dateReady, preferredTimezone),
    missedId: params.get('missed'),
    recovery: params.get('recovery'),
    recoveryTaskId: params.get('task'),
  });
  const fixed = useFixedEvents(dayQ.data, store.draft?.settings?.ignoredAllDayEventIds);
  const dayReview = params.get('review') === 'day';
  useRequestedDayReview({
    requested: dayReview,
    date,
    draft: store.draft,
    setStage: store.setStage,
  });
  const reviewLabel =
    previousDate === new Date().toLocaleDateString('en-CA', { timeZone: timezone })
      ? 'Review today'
      : 'Review yesterday';
  const allTasks = usePlanningCatalog(dayQ.data, previousQ.data, store.proposalContext);
  const startAt = remainingDayStart(date, timezone, store.planningStartAt);
  const tasks = useDailyPlanningTasks({
    date,
    timezone,
    draft: store.draft,
    editDraft: store.editDraft,
    setError: store.setError,
    fixed,
    startAt,
    actual: dayQ.data?.actual ?? [],
  });
  useRequestedTaskEditor({
    date,
    taskId: params.get('task'),
    recovery: params.get('recovery'),
    draft: store.draft,
    setEditing: tasks.setEditing,
  });
  const names = useMemo(
    () =>
      new Map([
        ...[...allTasks].map(([id, task]): [string, string] => [id, task.title]),
        ...Object.entries(tasks.taskNames),
      ]),
    [allTasks, tasks.taskNames],
  );
  const titleFor = (taskId: string): string =>
    names.get(taskId) ?? tasks.taskNames[taskId] ?? 'Task';
  return {
    date,
    previousDate,
    dayReview,
    preferencesError,
    retryPreferences,
    reviewLabel,
    dayQ,
    previousQ,
    timezone,
    fixed,
    startAt,
    allTasks,
    names,
    titleFor,
    ...store,
    ...tasks,
  };
}

/** Back the planning stages with a generated proposal and a resumable guarded draft. */
export function useDailyPlanningController() {
  const store = usePlanningDraft();
  const { date, previousDate } = store;
  const [search, setSearch] = useState('');
  const [workScope, setWorkScope] = useState<DailyWorkScope>('mine');
  const [workOrganization, setWorkOrganization] = useState('');
  const [dueOnly, setDueOnly] = useState(false);
  const review = useReviewChoices(previousDate, date);
  const [wasAdjustment, setWasAdjustment] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const searchQ = useAvailableDailyWork(
    date,
    search,
    {
      scope: workScope,
      orgId: workOrganization,
      dueOnly,
    },
    store.stage === 'add' || store.stage === 'plan' || store.stage === 'review',
  );
  const confirm = useConfirmDailyPlan(date);
  const move = useDailyPlanningMove({
    date,
    confirming,
    removeTask: store.removeTask,
    setError: store.setError,
  });
  const undo = usePlanUndo(store, confirm);
  const timer = useTimerState();
  const timerControls = useTimerControls(timer.record?.id ?? null);
  return {
    ...store,
    confirming,
    setConfirming,
    search,
    setSearch,
    searchQ,
    workScope,
    setWorkScope,
    workOrganization,
    setWorkOrganization,
    dueOnly,
    setDueOnly,
    confirm,
    ...move,
    go: async (next: Stage, value?: DailyPlanSnapshot): Promise<void> => {
      if (!move.isMovingTask()) await store.go(next, value);
    },
    setStage: (next: Stage): void => {
      if (!move.isMovingTask()) store.setStage(next);
    },
    applySavedDraft: async (): Promise<void> => {
      if (!move.isMovingTask()) await store.applySavedDraft();
    },
    timer,
    timerControls,
    wasAdjustment,
    setWasAdjustment,
    ...undo,
    ...review,
  };
}

/** A controller whose day has loaded a usable draft. */
export type ReadyPlanningController = ReturnType<typeof useDailyPlanningController> & {
  draft: DailyPlanSnapshot;
};
