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
import { useRouter } from 'next/navigation';
import { useAppPathname, useAppSearchParams } from '@/lib/app-location';
import { useCallback, useMemo } from 'react';

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
  /** Clear all filters / grouping / sort and restore the default presentation. */
  reset: () => void;
}

/**
 * Hold a list page's view state in the URL search params.
 *
 * @remarks
 * Reads the current {@link ViewState} from `useSearchParams` and writes mutations back with
 * `router.replace` (history-quiet, scroll-stable), preserving any unrelated params. All four
 * setters funnel through one `commit` so the whole state is re-encoded atomically.
 *
 * @returns the {@link UseViewStateResult}.
 */
export function useViewState(): UseViewStateResult {
  const router = useRouter();
  const pathname = useAppPathname();
  const searchParams = useAppSearchParams();

  // `useSearchParams` returns a stable `ReadonlyURLSearchParams`; key the parse on its string form
  // so the memo only recomputes when the query actually changes.
  const search = searchParams.toString();
  const state = useMemo<ViewState>(() => parseViewState(new URLSearchParams(search)), [search]);
  const display = useMemo<ViewDisplayState>(
    () => parseViewDisplay(new URLSearchParams(search)),
    [search],
  );

  const commit = useCallback(
    (next: ViewState, nextDisplay: ViewDisplayState): void => {
      const params = serializeViewState(next, new URLSearchParams(search));
      serializeViewDisplay(nextDisplay, params);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, search],
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
    commit({ filters: [], groupBy: null, sort: [] }, DEFAULT_VIEW_DISPLAY);
  }, [commit]);

  return { state, display, setFilters, setGroupBy, setSort, setDisplay, reset };
}
