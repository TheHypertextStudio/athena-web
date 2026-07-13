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
import type {
  AgendaOut,
  CalendarItemOut,
  CalendarItemsRangeOut,
  DailyPlanItemOut,
  HubTodayOut,
} from '@docket/types';
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

import { api } from '@/lib/api';
import { calendarItemsDef } from '@/components/calendar/calendar-data';
import {
  resolveScheduleTimezone,
  scheduleDateRange,
  useScheduleDisplayDate,
} from '@/components/scheduling';
import {
  apiQueryOptions,
  queryKeys,
  STALE,
  useApiListQuery,
  useApiQuery,
  usePrefetchApi,
} from '@/lib/query';
import { todayISODate } from '@/lib/today';
import { startViewTransition } from '@/lib/view-transition';

import { type AgendaPlanMutations, useAgendaPlanMutations } from './agenda-mutations';

const DEFAULT_PIXELS_PER_HOUR = 72;

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

/**
 * Entry source. `'task'` and `'google_calendar_event'` come from the Hub `today`/`agenda`
 * projections; `'calendar_item'` is the additive, provider-neutral member covering the full
 * layered-calendar {@link CalendarItemOut.kind} set (`provider_event`, `native_block`,
 * `task_timebox`, `availability_block`) via {@link toAgendaEntryFromCalendarItem} — added so the
 * shared {@link AgendaEntryCard}/full calendar view can render layered items without a rename or a
 * breaking change to the existing two sources.
 */
export type AgendaEntrySource = 'task' | 'google_calendar_event' | 'calendar_item';

/** One planned thing or external event on the agenda for a day. */
export interface AgendaEntry {
  /** Stable key for transitions and list rendering. */
  id: string;
  /** Entry source. */
  source: AgendaEntrySource;
  /** The underlying task, present for Docket task entries. */
  taskId?: string;
  /** The org that owns the task (the agenda is cross-org); absent for external calendar events. */
  organizationId?: string;
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
  /** Provider deep link for external events. */
  externalUrl?: string | null;
  /** Calendar/account context for external events. */
  calendar?: { title: string; color: string | null; accountEmail: string | null };
  /**
   * The full layered-calendar item, present for `source === 'calendar_item'` entries. Carries
   * `kind`/`provider`/`permissions`/`syncState` through to the shared card and item workspace
   * drawer without a second fetch.
   */
  calendarItem?: CalendarItemOut;
  /** The owning layer's display color, present for `source === 'calendar_item'` entries. */
  layerColor?: string | null;
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
export function toAgendaEntries(data: HubTodayOut | AgendaOut | null): AgendaEntry[] {
  if (!data) return [];
  if ('entries' in data) {
    return data.entries.map((entry, i) => {
      if (entry.kind === 'task_timebox') {
        return {
          id: entry.taskId,
          source: 'task',
          taskId: entry.taskId,
          organizationId: entry.organizationId,
          title: entry.title,
          startsAt: entry.startsAt,
          endsAt: entry.endsAt,
          sort: i,
          done: false,
        };
      }
      return {
        id: entry.event.id,
        source: 'google_calendar_event',
        title: entry.event.title,
        startsAt: entry.event.startsAt ?? undefined,
        endsAt: entry.event.endsAt ?? undefined,
        sort: i,
        done: false,
        externalUrl: entry.event.htmlLink,
        calendar: {
          title: entry.calendar.title,
          color: entry.calendar.color,
          accountEmail: entry.connection.accountEmail,
        },
      };
    });
  }
  const box = new Map(data.calendar.map((b) => [b.taskId, b]));
  const planned: AgendaEntry[] = data.plan.map((task, i) => {
    const block = box.get(task.id);
    return {
      id: task.id,
      source: 'task',
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
      source: 'task',
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

/**
 * Normalize one layered-calendar item into an {@link AgendaEntry} with `source: 'calendar_item'`.
 *
 * @remarks
 * The provider-neutral counterpart to {@link toAgendaEntries}: it carries the item's `kind`,
 * `provider`, `permissions`, and `syncState` through via {@link AgendaEntry.calendarItem} rather
 * than flattening them, so the shared {@link AgendaEntryCard} (and the full calendar view's
 * `CalendarItemCard`) can render every item kind (`provider_event`, `native_block`,
 * `task_timebox`, `availability_block`) without a one-off branch per source. Kept as a sibling
 * function of `toAgendaEntries` (rather than folded into it) so the Hub `today`/`agenda` seam's
 * existing contract stays untouched — this is purely additive.
 *
 * @param item - The calendar item to normalize.
 * @param sort - The item's position among its range (drives the same `sort` field the Hub-sourced
 * entries use for stable, untimed ordering).
 * @param layerColor - The owning layer's display color, when known.
 */
export function toAgendaEntryFromCalendarItem(
  item: CalendarItemOut,
  sort: number,
  layerColor?: string | null,
): AgendaEntry {
  return {
    id: item.id,
    source: 'calendar_item',
    title: item.title,
    startsAt: item.startsAt ?? undefined,
    endsAt: item.endsAt ?? undefined,
    sort,
    done: false,
    externalUrl: item.htmlLink,
    calendarItem: item,
    layerColor: layerColor ?? null,
  };
}

/**
 * Normalize an entire calendar-items range read into {@link AgendaEntry} list, in range order.
 *
 * @remarks
 * Resolves each item's layer color from the range's own `layers` array (the range read always
 * returns the layers its items belong to), so callers don't need a second layers fetch just to
 * color the entries.
 *
 * @param range - A calendar-items range read (`calendarItemsDef`'s resolved data).
 */
export function calendarItemsToAgendaEntries(range: CalendarItemsRangeOut): AgendaEntry[] {
  const colorByLayer = new Map(range.layers.map((layer) => [layer.id, layer.color]));
  return range.items.map((item, i) =>
    toAgendaEntryFromCalendarItem(item, i, colorByLayer.get(item.layerId)),
  );
}

/** The agenda's view modes. `list` is a chronological stream; `timeline` is the hour grid. */
export type AgendaView = 'list' | 'timeline';

/**
 * What every agenda component reads from context: the day's read + navigation state, plus the
 * in-place edit operations from {@link AgendaPlanMutations}.
 */
interface AgendaContextValue extends AgendaPlanMutations {
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
  /** Resolved Hub timezone shared by agenda range reads, geometry, and persistence. */
  displayTimezone: string;
  /** Persisted continuous calendar zoom, falling back to the shared default. */
  pixelsPerHour: number;
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
}

const AgendaContext = createContext<AgendaContextValue | null>(null);

/** Props for {@link AgendaProvider}. */
interface AgendaProviderProps {
  /** The day to start on (defaults to today). */
  readonly initialDate?: string;
  /** The agenda subtree that reads {@link useAgenda}. */
  readonly children: ReactNode;
}

// Day-parameterized query definitions, so the same key/fetcher serves both the active read and the
// adjacent-day prefetch (no drift between what we show and what we warm). Module-level because they
// close over nothing from the component — stable references, free of `useCallback`.

/** The combined agenda query definition for a given day. */
function agendaDef(date: string) {
  return apiQueryOptions(
    queryKeys.agenda(date),
    () => api.v1.agenda.$get({ query: { date } }),
    'Could not load your agenda.',
  );
}

/** The daily-plan query definition for a given day (source of plan-item ids + done status). */
function planDef(date: string) {
  return apiQueryOptions(
    queryKeys.dailyPlan(date),
    () => api.v1['daily-plan'].$get({ query: { date } }),
    'Could not load your plan.',
  );
}

/** The display-timezone day range used by the layered calendar read. */
function calendarDayRange(
  date: string,
  displayTimezone: string,
): { startISO: string; endISO: string } {
  return scheduleDateRange(date, 1, displayTimezone);
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
  const [view, setViewState] = useState<AgendaView>('timeline');
  const [now] = useState(() => new Date().toISOString());
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

  // `useApiListQuery` keeps the current day on screen while the next day loads (it bundles
  // `placeholderData: keepPreviousData`), so stepping days never blanks the grid to a skeleton —
  // only the very first load (no data at all) shows one.
  const query = useApiListQuery(agendaDef(date));
  const data: AgendaOut | null = query.data ?? null;
  const calendarRange = calendarDayRange(date, displayTimezone);
  const calendarQuery = useApiListQuery(
    calendarItemsDef(calendarRange.startISO, calendarRange.endISO),
  );

  // The daily plan carries the item id + checked-off status the Hub `today` projection lacks: we
  // source display (titles, timeboxes) from `today` and augment each entry with its plan-item id +
  // done flag, matched by task. Editing then has the id it needs without changing what's shown.
  const planQuery = useApiListQuery(planDef(date));
  const planByTask = useMemo(() => {
    const items = planQuery.data?.items ?? [];
    return new Map<string, DailyPlanItemOut>(items.map((item) => [item.refTaskId, item]));
  }, [planQuery.data]);

  // Warm the neighbouring days so prev/next resolve from cache: the day switch is then an instant
  // in-place update rather than a fetch-and-wait.
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
    const layeredEntries = calendarQuery.data
      ? calendarItemsToAgendaEntries(calendarQuery.data).filter(
          (entry) => data === null || entry.calendarItem?.kind !== 'task_timebox',
        )
      : [];
    const merged = new Map<string, AgendaEntry>();
    for (const entry of legacyEntries) merged.set(entry.id, entry);
    // Layered items win duplicate provider ids so agenda interactions retain the normalized
    // permissions, relationship drop target, and item-workspace identity. Task timeboxes above are
    // deliberately filtered while the legacy plan source is available, preserving plan controls.
    for (const entry of layeredEntries) merged.set(entry.id, entry);
    return [...merged.values()];
  }, [calendarQuery.data, data, planByTask]);

  // The day's in-place edit operations (check-off, set/clear timebox, move, remove), bound to this
  // day's caches. Owned by the write layer so the provider stays read + navigation only.
  const mutations = useAgendaPlanMutations(date);

  // Switching list ↔ timeline reshapes the *same* cards, so it runs inside a View Transition: each
  // carries a `view-transition-name` and morphs from its row box to its grid box. (Unsupported
  // browsers fall back to an instant update.)
  const setView = useCallback((next: AgendaView) => {
    startViewTransition(() => {
      setViewState(next);
    });
  }, []);
  // Day navigation is a plain, synchronous state change — deliberately NOT wrapped in a View
  // Transition. A different day is different data behind a fetch, not a reshape of what's on screen;
  // the browser's default full-page cross-fade only added latency. The hour grid is identical
  // structure and reconciles in place, so the click lands instantly and only the cards swap.
  const goToPreviousDay = useCallback(() => {
    setDate((d) => shiftISODate(d, -1));
  }, [setDate]);
  const goToNextDay = useCallback(() => {
    setDate((d) => shiftISODate(d, 1));
  }, [setDate]);
  const goToToday = useCallback(() => {
    setDate(today);
  }, [setDate, today]);

  const value = useMemo<AgendaContextValue>(
    () => ({
      date,
      isToday,
      entries,
      loading: query.isPending && calendarQuery.isPending,
      error:
        query.isError || calendarQuery.isError
          ? 'Calendar updates are temporarily unavailable.'
          : null,
      displayTimezone,
      pixelsPerHour,
      view,
      setView,
      goToPreviousDay,
      goToNextDay,
      goToToday,
      ...mutations,
    }),
    [
      date,
      isToday,
      entries,
      query.isPending,
      query.isError,
      calendarQuery.isPending,
      calendarQuery.isError,
      displayTimezone,
      pixelsPerHour,
      view,
      setView,
      goToPreviousDay,
      goToNextDay,
      goToToday,
      mutations,
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
