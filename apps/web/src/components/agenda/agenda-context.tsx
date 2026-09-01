'use client';

/** Agenda read, navigation, and mutation context. */
import type { AgendaOut } from '@docket/planning/agenda-contract';
import type { DailyPlanItemOut } from '@docket/planning/daily-plan-contract';
import type { WorkPlaceOut } from '@docket/planning/work-location-contract';
import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { readStoredInteger, writeStoredValue } from '@docket/ui/lib/browser-storage';

import { calendarItemsDef } from '@/components/calendar/calendar-data';
import { workLocationPlacesDef } from '@/components/work-location/work-location-data';
import {
  type WorkLocationCalendarComposition,
  useWorkLocationCalendarComposition,
} from '@/components/work-location/use-work-location-calendar-composition';
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
import { type AgendaDayContext, partitionAgendaDay } from './agenda-day-context';
import { normalizeAgendaScale } from './agenda-scale';
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

/**
 * The rail's own resting density, deliberately not the calendar page's 72.
 *
 * @remarks
 * 48 is the product's existing `Compact` preset. At 72 a day is 1728px tall and a rail shows about
 * nine hours of it; at 48 it is 1152px and the rail shows roughly fourteen, which is most of a
 * working day without scrolling. The rail reads a schedule; the calendar page edits one, and it
 * keeps its own density for that.
 */
const RAIL_PIXELS_PER_HOUR = 48;

/** Where the rail's chosen density survives a reload. */
const RAIL_SCALE_KEY = 'docket.rail.agenda.scale';

/**
 * Read the persisted rail density, or `null` when there is nothing legible stored.
 *
 * @remarks
 * Deliberately not called from a `useState` initializer: the rail is server-rendered, and reading
 * storage during the first render is exactly the hydration mismatch
 * {@link file://../../../../../packages/ui/src/lib/browser-storage.ts} documents. Read on mount
 * instead, like the shell's own rail state.
 *
 * Values from the earlier continuous scale are snapped to the nearest intentional Agenda step.
 */
function readRailScale(): number | null {
  const stored = readStoredInteger(RAIL_SCALE_KEY);
  return stored === null ? null : normalizeAgendaScale(stored);
}

interface AgendaContextValue extends AgendaPlanMutations {
  date: string;
  today: string;
  isToday: boolean;
  entries: AgendaEntry[];
  dayContext: AgendaDayContext[];
  workLocationComposition?: WorkLocationCalendarComposition | undefined;
  workPlaces: WorkPlaceOut[];
  loading: boolean;
  error: string | null;
  retrying: boolean;
  displayTimezone: string;
  pixelsPerHour: number;
  /** Select one of the rail's intentional whole-number density steps. */
  setScale: (pixelsPerHour: number) => void;
  view: AgendaView;
  setView: (view: AgendaView) => void;
  goToPreviousDay: () => void;
  goToNextDay: () => void;
  goToToday: () => void;
  goToDate: (date: string) => void;
  /** Register a draft guard that may veto date changes; returns its cleanup function. */
  registerNavigationGuard: (guard: () => boolean) => () => void;
  retry: () => void;
}

const AgendaContext = createContext<AgendaContextValue | null>(null);

/** Props for the agenda data provider. */
interface AgendaProviderProps {
  readonly initialDate?: string | undefined;
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
  const navigationGuardRef = useRef<(() => boolean) | null>(null);
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
  const [pixelsPerHour, setPixelsPerHour] = useState(RAIL_PIXELS_PER_HOUR);
  useEffect(() => {
    const stored = readRailScale();
    if (stored !== null) setPixelsPerHour(stored);
  }, []);
  const updateScale = useCallback((nextScale: (current: number) => number) => {
    setPixelsPerHour((current) => {
      const next = nextScale(current);
      writeStoredValue(RAIL_SCALE_KEY, next);
      return next;
    });
  }, []);
  const setScale = useCallback(
    (nextScale: number) => {
      updateScale(() => normalizeAgendaScale(nextScale));
    },
    [updateScale],
  );
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
  const workPlacesQuery = useApiListQuery(workLocationPlacesDef());
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

  const agendaDay = useMemo(() => {
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
    return partitionAgendaDay([...merged.values()]);
  }, [calendarQuery.data, calendarQuery.isPlaceholderData, data, planByTask]);

  const mutations = useAgendaPlanMutations(date);
  const setView = useCallback((next: AgendaView) => {
    startViewTransition(() => {
      setViewState(next);
    });
  }, []);
  const registerNavigationGuard = useCallback((guard: () => boolean) => {
    navigationGuardRef.current = guard;
    return () => {
      if (navigationGuardRef.current === guard) navigationGuardRef.current = null;
    };
  }, []);
  const mayNavigate = useCallback(() => navigationGuardRef.current?.() ?? true, []);
  const goToPreviousDay = useCallback(() => {
    if (mayNavigate()) setDate((current) => shiftISODate(current, -1));
  }, [mayNavigate, setDate]);
  const goToNextDay = useCallback(() => {
    if (mayNavigate()) setDate((current) => shiftISODate(current, 1));
  }, [mayNavigate, setDate]);
  const goToToday = useCallback(() => {
    if (mayNavigate()) setDate(today);
  }, [mayNavigate, setDate, today]);
  const goToDate = useCallback(
    (nextDate: string) => {
      if (nextDate !== date && mayNavigate()) setDate(nextDate);
    },
    [date, mayNavigate, setDate],
  );
  const retry = useCallback(() => {
    void preferencesQuery.refetch();
    void query.refetch();
    void calendarQuery.refetch();
    void planQuery.refetch();
  }, [calendarQuery, planQuery, preferencesQuery, query]);
  const workLocationRange = calendarDayRange(date, displayTimezone);
  const workLocationComposition = useWorkLocationCalendarComposition({
    start: workLocationRange.startISO,
    end: workLocationRange.endISO,
    timezone: displayTimezone,
    lanes: [{ id: `agenda:${date}`, date, label: date, items: [] }],
  });

  const value = useMemo<AgendaContextValue>(
    () => ({
      date,
      today,
      isToday,
      entries: agendaDay.entries,
      dayContext: agendaDay.dayContext,
      workLocationComposition,
      workPlaces: workPlacesQuery.data?.items ?? [],
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
      setScale,
      view,
      setView,
      goToPreviousDay,
      goToNextDay,
      goToToday,
      goToDate,
      registerNavigationGuard,
      retry,
      ...mutations,
    }),
    [
      date,
      today,
      isToday,
      agendaDay,
      workLocationComposition,
      workPlacesQuery.data,
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
      setScale,
      view,
      setView,
      goToPreviousDay,
      goToNextDay,
      goToToday,
      goToDate,
      registerNavigationGuard,
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
