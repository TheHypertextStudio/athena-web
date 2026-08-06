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
  clampPixelsPerHour,
  MAX_PIXELS_PER_HOUR,
  MIN_PIXELS_PER_HOUR,
  resolveScheduleTimezone,
  scheduleDateRange,
  useScheduleDisplayDate,
  ZOOM_STEP_IN,
  ZOOM_STEP_OUT,
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
 * `localStorage` during the first render is exactly the hydration mismatch the shell's own rail
 * state avoids by reading in an effect instead.
 */
function readRailScale(): number | null {
  if (typeof window === 'undefined') return null;
  const stored = window.localStorage.getItem(RAIL_SCALE_KEY);
  if (stored === null) return null;
  const parsed = Number.parseInt(stored, 10);
  return Number.isFinite(parsed) ? clampPixelsPerHour(parsed) : null;
}

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
  /** One step coarser/finer on the shared zoom scale, persisted for this rail alone. */
  zoomIn: () => void;
  zoomOut: () => void;
  /** The rail's density as a multiple of its own resting scale, for the stepper's readout. */
  scaleMultiplier: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
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
  const [pixelsPerHour, setPixelsPerHour] = useState(RAIL_PIXELS_PER_HOUR);
  useEffect(() => {
    const stored = readRailScale();
    if (stored !== null) setPixelsPerHour(stored);
  }, []);
  const zoomBy = useCallback((factor: number) => {
    setPixelsPerHour((current) => {
      const next = clampPixelsPerHour(current * factor);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(RAIL_SCALE_KEY, String(next));
      }
      return next;
    });
  }, []);
  const zoomIn = useCallback(() => {
    zoomBy(ZOOM_STEP_IN);
  }, [zoomBy]);
  const zoomOut = useCallback(() => {
    zoomBy(ZOOM_STEP_OUT);
  }, [zoomBy]);
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
      zoomIn,
      zoomOut,
      scaleMultiplier: pixelsPerHour / RAIL_PIXELS_PER_HOUR,
      canZoomIn: pixelsPerHour < MAX_PIXELS_PER_HOUR,
      canZoomOut: pixelsPerHour > MIN_PIXELS_PER_HOUR,
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
      zoomIn,
      zoomOut,
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
