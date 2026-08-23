'use client';

/**
 * `views` — the hook that holds a list's {@link ViewState} and persists it to the URL.
 *
 * @remarks
 * The single state owner the unified {@link import('./filter-toolbar').FilterToolbar} reads and
 * writes. Rather than `useState`, it derives the view state *from the URL* via
 * {@link parseViewState} and writes changes back via `router.replace`, so a configured list is
 * shareable (the link encodes the filters) and sticky (a reload re-parses them). This keeps the
 * URL the single source of truth — there is no second copy of the state to drift.
 *
 * It returns the current {@link ViewState} plus granular setters (filters / grouping / sort) and
 * a `reset`, each of which re-serializes the whole state onto the existing search params (so
 * unrelated params — a tab id, a detail id — are preserved) and replaces the URL without adding
 * a history entry, so the back button is not polluted by every chip toggle. `scroll: false`
 * keeps the list from jumping on a filter change.
 *
 * This hook is intentionally thin (the codec it wraps is pure and separately unit-tested); it
 * exists only to bind that codec to Next's navigation primitives.
 */
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { useAppPathname, useAppSearchParams } from '@/lib/app-location';
import { useImmediateUrlState } from '@/lib/interactions/immediate-url-state';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import {
  DEFAULT_VIEW_DISPLAY,
  type ViewDisplayState,
  type ViewFilterTerm,
  type ViewGroupTerm,
  type ViewSortTerm,
  type ViewState,
} from './field-catalog';
import {
  parseViewDisplay,
  parseViewState,
  serializeViewDisplay,
  serializeViewState,
  VIEW_PARAM_KEYS,
} from './view-state-url';

/** The value returned by {@link useViewState}: the current state plus its setters. */
export interface UseViewStateResult {
  /** The current view state, parsed from the URL. */
  state: ViewState;
  /**
   * The current presentation toggles, parsed from the URL.
   *
   * @remarks
   * Held alongside — never inside — {@link ViewState}: the query is what a saved view persists and
   * shares, while presentation is a per-viewer preference. Both ride the same URL so a configured
   * lens stays shareable and reload-stable.
   */
  display: ViewDisplayState;
  /** Replace the active filter predicates. */
  setFilters: (filters: readonly ViewFilterTerm[]) => void;
  /** Replace the active grouping (or clear it with `null`). */
  setGroupBy: (groupBy: ViewGroupTerm | null) => void;
  /** Replace the active sort terms. */
  setSort: (sort: readonly ViewSortTerm[]) => void;
  /** Replace the presentation toggles. */
  setDisplay: (display: ViewDisplayState) => void;
  /** Replace one URL parameter that is not owned by the view codec. */
  setSearchParam: (name: string, value: string | null) => void;
  /** Push one non-view URL parameter while preserving pending view and search writes. */
  pushSearchParam: (name: string, value: string | null) => void;
  /** Push several related non-view parameters as one browser-history entry. */
  pushSearchParams: (updates: Readonly<Record<string, string | null>>) => void;
  /** Clear all filters / grouping / sort and restore the default presentation. */
  reset: () => void;
}

/** Surface defaults that still preserve explicit contrary choices in the shared URL codec. */
export interface UseViewStateDefaults {
  /** Grouping used when the URL carries no group value. */
  readonly groupBy?: ViewGroupTerm | null;
}

const EMPTY_VIEW_STATE_DEFAULTS: UseViewStateDefaults = {};

/**
 * Hold a list page's view state in the URL search params.
 *
 * @remarks
 * Reads the current {@link ViewState} from `useSearchParams` and writes mutations back with
 * `router.replace` (history-quiet, scroll-stable), preserving any unrelated params. View setters
 * funnel through one `commit`, and non-view replace/push writes share its pending URL transaction
 * so rapid actions cannot overwrite one another.
 *
 * @returns the {@link UseViewStateResult}.
 */
export function useViewState(
  defaults: UseViewStateDefaults = EMPTY_VIEW_STATE_DEFAULTS,
): UseViewStateResult {
  const router = useRouter();
  const pathname = useAppPathname();
  const searchParams = useAppSearchParams();

  // `useSearchParams` returns a stable `ReadonlyURLSearchParams`; key the parse on its string form
  // so the memo only recomputes when the query actually changes.
  const search = searchParams.toString();
  const pendingSearch = useRef(search);
  const requestedSearch = useRef<string | null>(null);
  useEffect(() => {
    if (requestedSearch.current !== null) {
      if (search === requestedSearch.current) {
        requestedSearch.current = null;
        pendingSearch.current = search;
      }
      return;
    }
    pendingSearch.current = search;
  }, [search]);
  const canonicalState = useMemo<ViewState>(
    () => parseViewState(new URLSearchParams(search), defaults),
    [defaults, search],
  );
  const canonicalDisplay = useMemo<ViewDisplayState>(
    () => parseViewDisplay(new URLSearchParams(search)),
    [search],
  );
  const [state, setImmediateState] = useImmediateUrlState(canonicalState, sameSerializedValue);
  const [display, setImmediateDisplay] = useImmediateUrlState(
    canonicalDisplay,
    sameSerializedValue,
  );

  const navigateParams = useCallback(
    (params: URLSearchParams, mode: 'replace' | 'push'): void => {
      const query = params.toString();
      if (mode === 'replace' && query === pendingSearch.current) return;
      pendingSearch.current = query;
      requestedSearch.current = query;
      router[mode](query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const replaceParams = useCallback(
    (params: URLSearchParams): void => {
      navigateParams(params, 'replace');
    },
    [navigateParams],
  );

  const commit = useCallback(
    (next: ViewState, nextDisplay: ViewDisplayState): void => {
      setImmediateState(next);
      setImmediateDisplay(nextDisplay);
      const params = serializeViewState(next, new URLSearchParams(pendingSearch.current), defaults);
      serializeViewDisplay(nextDisplay, params);
      replaceParams(params);
    },
    [defaults, replaceParams, setImmediateDisplay, setImmediateState],
  );

  const setSearchParam = useCallback(
    (name: string, value: string | null): void => {
      if (VIEW_PARAM_KEYS.includes(name)) {
        throw new Error(`View-owned URL parameter cannot be written directly: ${name}`);
      }
      const params = new URLSearchParams(pendingSearch.current);
      if (value === null || value.length === 0) params.delete(name);
      else params.set(name, value);
      replaceParams(params);
    },
    [replaceParams],
  );

  const pushSearchParams = useCallback(
    (updates: Readonly<Record<string, string | null>>): void => {
      const params = new URLSearchParams(pendingSearch.current);
      for (const [name, value] of Object.entries(updates)) {
        if (VIEW_PARAM_KEYS.includes(name)) {
          throw new Error(`View-owned URL parameter cannot be written directly: ${name}`);
        }
        if (value === null || value.length === 0) params.delete(name);
        else params.set(name, value);
      }
      navigateParams(params, 'push');
    },
    [navigateParams],
  );

  const pushSearchParam = useCallback(
    (name: string, value: string | null): void => {
      pushSearchParams({ [name]: value });
    },
    [pushSearchParams],
  );

  const setFilters = useCallback(
    (filters: readonly ViewFilterTerm[]): void => {
      commit({ ...state, filters }, display);
    },
    [commit, display, state],
  );
  const setGroupBy = useCallback(
    (groupBy: ViewGroupTerm | null): void => {
      commit({ ...state, groupBy }, display);
    },
    [commit, display, state],
  );
  const setSort = useCallback(
    (sort: readonly ViewSortTerm[]): void => {
      commit({ ...state, sort }, display);
    },
    [commit, display, state],
  );
  const setDisplay = useCallback(
    (next: ViewDisplayState): void => {
      commit(state, next);
    },
    [commit, state],
  );
  const reset = useCallback((): void => {
    commit({ filters: [], groupBy: defaults.groupBy ?? null, sort: [] }, DEFAULT_VIEW_DISPLAY);
  }, [commit, defaults.groupBy]);

  return {
    state,
    display,
    setFilters,
    setGroupBy,
    setSort,
    setDisplay,
    setSearchParam,
    pushSearchParam,
    pushSearchParams,
    reset,
  };
}

/** Compare URL-codec values without treating a fresh parse of the same query as a new intent. */
function sameSerializedValue<T>(left: T, right: T): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
