'use client';

/** Agenda read, navigation, and mutation context. */
import type { AgendaOut, DailyPlanItemOut } from '@docket/types';
import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { calendarItemsDef } from '@/components/calendar/calendar-data';
import {
  resolveScheduleTimezone,
  scheduleDateRange,
  useScheduleDisplayDate,
} from '@/components/scheduling';
import { api } from '@/lib/api';
import {
  apiQueryOptions,
  queryKeys,
  STALE,
  useApiListQuery,
  useApiQuery,
  usePrefetchApi,
} from '@/lib/query';
import { useNow } from '@/lib/use-now';
import { startViewTransition } from '@/lib/view-transition';

import { type AgendaPlanMutations, useAgendaPlanMutations } from './agenda-mutations';
import { filterAgendaForDisplayDate } from './agenda-day-filter';
import {
  type AgendaEntry,
  type AgendaView,
  calendarItemsToAgendaEntries,
  shiftISODate,
  toAgendaEntries,
} from './agenda-model';

export {
  type AgendaEntry,
  type AgendaEntrySource,
  type AgendaView,
  type TimeboxedEntry,
  agendaEntryTransitionName,
  calendarItemsToAgendaEntries,
  isTimeboxed,
  shiftISODate,
  toAgendaEntries,
  toAgendaEntryFromCalendarItem,
} from './agenda-model';

const DEFAULT_PIXELS_PER_HOUR = 72;

interface AgendaContextValue extends AgendaPlanMutations {
  date: string;
  today: string;
  isToday: boolean;
  entries: AgendaEntry[];
  loading: boolean;
  error: string | null;
  retrying: boolean;
  displayTimezone: string;
  pixelsPerHour: number;
  view: AgendaView;
  setView: (view: AgendaView) => void;
  goToPreviousDay: () => void;
  goToNextDay: () => void;
  goToToday: () => void;
  retry: () => void;
}

const AgendaContext = createContext<AgendaContextValue | null>(null);

/** Props for the agenda data provider. */
interface AgendaProviderProps {
  readonly initialDate?: string;
  readonly children: ReactNode;
}

function agendaDef(date: string) {
  return apiQueryOptions(
    queryKeys.agenda(date),
    () => api.v1.agenda.$get({ query: { date } }),
    'Could not load your agenda.',
  );
}

function planDef(date: string) {
  return apiQueryOptions(
    queryKeys.dailyPlan(date),
    () => api.v1['daily-plan'].$get({ query: { date } }),
    'Could not load your plan.',
  );
}

function calendarDayRange(date: string, displayTimezone: string) {
  return scheduleDateRange(date, 1, displayTimezone);
}

/** Provide the selected agenda day, normalized entries, and in-place mutations. */
export function AgendaProvider({ initialDate, children }: AgendaProviderProps): JSX.Element {
  const [view, setViewState] = useState<AgendaView>('timeline');
  const now = useNow().toISOString();
  const preferencesQuery = useApiQuery(
    apiQueryOptions(
      queryKeys.hubPreferences(),
      () => api.v1.hub.preferences.$get(),
      'Could not load agenda preferences.',
      { staleTime: STALE.standard },
    ),
  );
  const displayTimezone = resolveScheduleTimezone(preferencesQuery.data?.timezone);
  const pixelsPerHour = preferencesQuery.data?.calendar?.pixelsPerHour ?? DEFAULT_PIXELS_PER_HOUR;
  const { date, isToday, today, setDate } = useScheduleDisplayDate({
    initialDate,
    displayTimezone,
    preferencesReady: preferencesQuery.data !== undefined,
    now,
  });
  const query = useApiListQuery(agendaDef(date));
  const data: AgendaOut | null =
    query.data && !query.isPlaceholderData
      ? filterAgendaForDisplayDate(query.data, date, displayTimezone)
      : null;
  const calendarRange = calendarDayRange(date, displayTimezone);
  const calendarQuery = useApiListQuery(
    calendarItemsDef(calendarRange.startISO, calendarRange.endISO),
  );
  const planQuery = useApiListQuery(planDef(date));
  const planByTask = useMemo(() => {
    const items = planQuery.isPlaceholderData ? [] : (planQuery.data?.items ?? []);
    return new Map<string, DailyPlanItemOut>(items.map((item) => [item.refTaskId, item]));
  }, [planQuery.data, planQuery.isPlaceholderData]);

  const prefetch = usePrefetchApi();
  useEffect(() => {
    for (const neighbour of [shiftISODate(date, -1), shiftISODate(date, 1)]) {
      prefetch(agendaDef(neighbour));
      prefetch(planDef(neighbour));
      const range = calendarDayRange(neighbour, displayTimezone);
      prefetch(calendarItemsDef(range.startISO, range.endISO));
    }
  }, [date, displayTimezone, prefetch]);

  const entries = useMemo(() => {
    const legacyEntries = toAgendaEntries(data).map((entry) => {
      const item = entry.taskId ? planByTask.get(entry.taskId) : undefined;
      return item ? { ...entry, planItemId: item.id, done: item.status === 'done' } : entry;
    });
    const layeredEntries =
      calendarQuery.data && !calendarQuery.isPlaceholderData
        ? calendarItemsToAgendaEntries(calendarQuery.data).filter(
            (entry) => data === null || entry.calendarItem?.kind !== 'task_timebox',
          )
        : [];
    const merged = new Map<string, AgendaEntry>();
    for (const entry of legacyEntries) merged.set(entry.id, entry);
    for (const entry of layeredEntries) merged.set(entry.id, entry);
    return [...merged.values()];
  }, [calendarQuery.data, calendarQuery.isPlaceholderData, data, planByTask]);

  const mutations = useAgendaPlanMutations(date);
  const setView = useCallback((next: AgendaView) => {
    startViewTransition(() => {
      setViewState(next);
    });
  }, []);
  const goToPreviousDay = useCallback(() => {
    setDate((current) => shiftISODate(current, -1));
  }, [setDate]);
  const goToNextDay = useCallback(() => {
    setDate((current) => shiftISODate(current, 1));
  }, [setDate]);
  const goToToday = useCallback(() => {
    setDate(today);
  }, [setDate, today]);
  const retry = useCallback(() => {
    void preferencesQuery.refetch();
    void query.refetch();
    void calendarQuery.refetch();
    void planQuery.refetch();
  }, [calendarQuery, planQuery, preferencesQuery, query]);

  const value = useMemo<AgendaContextValue>(
    () => ({
      date,
      today,
      isToday,
      entries,
      loading:
        query.isPending ||
        query.isPlaceholderData ||
        calendarQuery.isPending ||
        calendarQuery.isPlaceholderData,
      error:
        preferencesQuery.isError || query.isError || calendarQuery.isError || planQuery.isError
          ? 'Calendar updates are temporarily unavailable.'
          : null,
      retrying:
        preferencesQuery.isFetching ||
        query.isFetching ||
        calendarQuery.isFetching ||
        planQuery.isFetching,
      displayTimezone,
      pixelsPerHour,
      view,
      setView,
      goToPreviousDay,
      goToNextDay,
      goToToday,
      retry,
      ...mutations,
    }),
    [
      date,
      today,
      isToday,
      entries,
      query.isPending,
      query.isPlaceholderData,
      query.isError,
      query.isFetching,
      calendarQuery.isPending,
      calendarQuery.isPlaceholderData,
      calendarQuery.isError,
      calendarQuery.isFetching,
      planQuery.isError,
      planQuery.isFetching,
      preferencesQuery.isError,
      preferencesQuery.isFetching,
      displayTimezone,
      pixelsPerHour,
      view,
      setView,
      goToPreviousDay,
      goToNextDay,
      goToToday,
      retry,
      mutations,
    ],
  );
  return <AgendaContext.Provider value={value}>{children}</AgendaContext.Provider>;
}

/** Read agenda state from the nearest provider. */
export function useAgenda(): AgendaContextValue {
  const context = useContext(AgendaContext);
  if (!context) throw new Error('useAgenda must be used within an AgendaProvider');
  return context;
}
