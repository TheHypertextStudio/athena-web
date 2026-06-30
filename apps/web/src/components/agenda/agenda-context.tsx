'use client';

/**
 * `agenda/agenda-context` — the agenda's data layer: the entry model and its normalizer, plus the
 * provider/hook that fetch a day and expose it.
 *
 * @remarks
 * Composition over drilling: the provider fetches + normalizes once, and every view/row pulls what
 * it needs via {@link useAgenda} rather than receiving items through props. The {@link AgendaEntry}
 * model is the seam between source and views — when a later slice swaps the source to the
 * `/v1/daily-plan` CRUD, only {@link toAgendaEntries} and the query in {@link AgendaProvider} change.
 */
import type { DailyPlanItemOut, DailyPlanItemStatus, HubTodayOut } from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

import { api } from '@/lib/api';
import {
  apiQueryOptions,
  optimisticPatch,
  queryKeys,
  unwrap,
  useApiMutation,
  useApiQuery,
} from '@/lib/query';
import { todayISODate } from '@/lib/today';
import { startViewTransition } from '@/lib/view-transition';

/** Stable `view-transition-name` for an agenda entry, so it morphs across views (list ↔ timeline). */
export function agendaEntryTransitionName(entryId: string): string {
  return `agenda-entry-${entryId}`;
}

/** Shift a `YYYY-MM-DD` calendar day by whole days, staying in the local timezone. */
export function shiftISODate(iso: string, deltaDays: number): string {
  // `${iso}T00:00:00` (no zone) parses as local midnight; `setDate` rolls months/years correctly.
  const day = new Date(`${iso}T00:00:00`);
  day.setDate(day.getDate() + deltaDays);
  return todayISODate(day);
}

/** One planned thing on the agenda for a day — a task, optionally timeboxed to a window. */
export interface AgendaEntry {
  /** Stable key — the task id (one plan entry per task per day). */
  id: string;
  /** The underlying task. */
  taskId: string;
  /** The org that owns the task (the agenda is cross-org). */
  organizationId: string;
  /** Display title. */
  title: string;
  /** Timebox window start (ISO), when the entry is scheduled to a time. */
  startsAt?: string;
  /** Timebox window end (ISO). */
  endsAt?: string;
  /** Order on the day's plan. */
  sort: number;
  /** Whether the entry is checked off for the day. */
  done: boolean;
  /** The daily-plan item id, present when the entry is on the plan (enables check-off / edits). */
  planItemId?: string;
}

/** A timeboxed entry — one that occupies a window and therefore renders on the timeline. */
export type TimeboxedEntry = AgendaEntry & { startsAt: string; endsAt: string };

/** Narrow an entry to a {@link TimeboxedEntry} (has both window bounds). */
export function isTimeboxed(entry: AgendaEntry): entry is TimeboxedEntry {
  return entry.startsAt != null && entry.endsAt != null;
}

/**
 * Normalize the Hub `today` payload into agenda entries.
 *
 * @remarks
 * Plan tasks become entries in plan order with their timebox window attached from the `calendar`
 * projection. Any timeboxed block whose task isn't in the plan is appended (defensive), so the
 * timeline never silently drops a scheduled block.
 */
export function toAgendaEntries(data: HubTodayOut | null): AgendaEntry[] {
  if (!data) return [];
  const box = new Map(data.calendar.map((b) => [b.taskId, b]));
  const planned: AgendaEntry[] = data.plan.map((task, i) => {
    const block = box.get(task.id);
    return {
      id: task.id,
      taskId: task.id,
      organizationId: task.organizationId,
      title: task.title,
      startsAt: block?.startsAt,
      endsAt: block?.endsAt,
      sort: i,
      done: false,
    };
  });
  const planIds = new Set(data.plan.map((t) => t.id));
  const orphanBlocks: AgendaEntry[] = data.calendar
    .filter((b) => !planIds.has(b.taskId))
    .map((b, i) => ({
      id: b.taskId,
      taskId: b.taskId,
      organizationId: b.organizationId,
      title: 'Timeboxed work',
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      sort: planned.length + i,
      done: false,
    }));
  return [...planned, ...orphanBlocks];
}

/** The agenda's view modes. `list` is a chronological stream; `timeline` is the hour grid. */
export type AgendaView = 'list' | 'timeline';

/** What every agenda component reads from context. */
interface AgendaContextValue {
  /** The ISO date this agenda is showing. */
  date: string;
  /** Whether {@link date} is today (drives the "jump to today" affordance). */
  isToday: boolean;
  /** The day's normalized entries (plan order). */
  entries: AgendaEntry[];
  /** Whether the first load is in flight. */
  loading: boolean;
  /** A load error message, or `null`. */
  error: string | null;
  /** The active view mode. */
  view: AgendaView;
  /** Switch the active view. */
  setView: (view: AgendaView) => void;
  /** Step back a day. */
  goToPreviousDay: () => void;
  /** Step forward a day. */
  goToNextDay: () => void;
  /** Jump back to today. */
  goToToday: () => void;
  /** Check an entry off for the day (or un-check it). No-op for entries not on the plan. */
  toggleDone: (entry: AgendaEntry) => void;
}

const AgendaContext = createContext<AgendaContextValue | null>(null);

/** Props for {@link AgendaProvider}. */
interface AgendaProviderProps {
  /** The day to start on (defaults to today). */
  readonly initialDate?: string;
  /** The agenda subtree that reads {@link useAgenda}. */
  readonly children: ReactNode;
}

/**
 * Owns the selected day, fetches its agenda, and provides both to descendants.
 *
 * @remarks
 * The provider owns the navigated date (defaulting to today), so day navigation is internal state —
 * views call {@link useAgenda}'s `goTo*` actions, they don't thread the date around. Reuses the Hub
 * `today` query (keyed by date), so today's view shares cache with the Today page's "Next up".
 */
export function AgendaProvider({ initialDate, children }: AgendaProviderProps): JSX.Element {
  const [date, setDate] = useState(() => initialDate ?? todayISODate());
  const [view, setViewState] = useState<AgendaView>('list');

  const queryClient = useQueryClient();

  const query = useApiQuery(
    apiQueryOptions(
      queryKeys.today(date),
      () => api.v1.hub.today.$get({ query: { date } }),
      'Could not load your agenda.',
    ),
  );
  const data: HubTodayOut | null = query.data ?? null;

  // The daily plan carries the item id + checked-off status the Hub `today` projection lacks: we
  // source display (titles, timeboxes) from `today` and augment each entry with its plan-item id +
  // done flag, matched by task. Editing then has the id it needs without changing what's shown.
  const planQuery = useApiQuery(
    apiQueryOptions(
      queryKeys.dailyPlan(date),
      () => api.v1['daily-plan'].$get({ query: { date } }),
      'Could not load your plan.',
    ),
  );
  const planByTask = useMemo(() => {
    const items = planQuery.data?.items ?? [];
    return new Map<string, DailyPlanItemOut>(items.map((item) => [item.refTaskId, item]));
  }, [planQuery.data]);

  const entries = useMemo(
    () =>
      toAgendaEntries(data).map((entry) => {
        const item = planByTask.get(entry.taskId);
        return item ? { ...entry, planItemId: item.id, done: item.status === 'done' } : entry;
      }),
    [data, planByTask],
  );

  const toggle = useApiMutation({
    mutationFn: (vars: { id: string; status: DailyPlanItemStatus }) =>
      unwrap(
        () =>
          api.v1['daily-plan'][':id'].$patch({
            param: { id: vars.id },
            json: { status: vars.status },
          }),
        'Could not update your plan.',
      ),
    onMutate: (vars) =>
      optimisticPatch<{ items: DailyPlanItemOut[] }>(
        queryClient,
        queryKeys.dailyPlan(date),
        (prev) => ({
          items: prev.items.map((item) =>
            item.id === vars.id ? { ...item, status: vars.status } : item,
          ),
        }),
      ),
    onError: (_error, _vars, context) => context?.rollback(),
    invalidateKeys: [queryKeys.dailyPlan(date), queryKeys.today(date)],
  });

  const toggleDone = useCallback(
    (entry: AgendaEntry) => {
      const id = entry.planItemId;
      if (!id) return;
      toggle.mutate({ id, status: entry.done ? 'planned' : 'done' });
    },
    [toggle],
  );

  // Every state change runs inside a View Transition, so the change ANIMATES rather than swaps:
  // entries that carry a `view-transition-name` morph between arrangements (list ↔ timeline, day →
  // day). Unsupported browsers fall back to an instant update.
  const setView = useCallback((next: AgendaView) => {
    startViewTransition(() => {
      setViewState(next);
    });
  }, []);
  const goToPreviousDay = useCallback(() => {
    startViewTransition(() => {
      setDate((d) => shiftISODate(d, -1));
    });
  }, []);
  const goToNextDay = useCallback(() => {
    startViewTransition(() => {
      setDate((d) => shiftISODate(d, 1));
    });
  }, []);
  const goToToday = useCallback(() => {
    startViewTransition(() => {
      setDate(todayISODate());
    });
  }, []);

  const value = useMemo<AgendaContextValue>(
    () => ({
      date,
      isToday: date === todayISODate(),
      entries,
      loading: query.isPending,
      error: query.error ? query.error.message : null,
      view,
      setView,
      goToPreviousDay,
      goToNextDay,
      goToToday,
      toggleDone,
    }),
    [
      date,
      entries,
      query.isPending,
      query.error,
      view,
      setView,
      goToPreviousDay,
      goToNextDay,
      goToToday,
      toggleDone,
    ],
  );
  return <AgendaContext.Provider value={value}>{children}</AgendaContext.Provider>;
}

/** Read the current agenda (entries, date, load state). Must be used within an {@link AgendaProvider}. */
export function useAgenda(): AgendaContextValue {
  const context = useContext(AgendaContext);
  if (!context) throw new Error('useAgenda must be used within an AgendaProvider');
  return context;
}
