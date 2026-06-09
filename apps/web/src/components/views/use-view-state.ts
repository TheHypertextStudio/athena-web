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
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

import {
  type ViewFilterTerm,
  type ViewGroupTerm,
  type ViewSortTerm,
  type ViewState,
} from './field-catalog';
import { parseViewState, serializeViewState } from './view-state-url';

/** The value returned by {@link useViewState}: the current state plus its setters. */
export interface UseViewStateResult {
  /** The current view state, parsed from the URL. */
  state: ViewState;
  /** Replace the active filter predicates. */
  setFilters: (filters: readonly ViewFilterTerm[]) => void;
  /** Replace the active grouping (or clear it with `null`). */
  setGroupBy: (groupBy: ViewGroupTerm | null) => void;
  /** Replace the active sort terms. */
  setSort: (sort: readonly ViewSortTerm[]) => void;
  /** Clear all filters / grouping / sort (back to the empty state). */
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
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // `useSearchParams` returns a stable `ReadonlyURLSearchParams`; key the parse on its string form
  // so the memo only recomputes when the query actually changes.
  const search = searchParams.toString();
  const state = useMemo<ViewState>(() => parseViewState(new URLSearchParams(search)), [search]);

  const commit = useCallback(
    (next: ViewState): void => {
      const params = serializeViewState(next, new URLSearchParams(search));
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, search],
  );

  const setFilters = useCallback(
    (filters: readonly ViewFilterTerm[]): void => {
      commit({ ...state, filters });
    },
    [commit, state],
  );
  const setGroupBy = useCallback(
    (groupBy: ViewGroupTerm | null): void => {
      commit({ ...state, groupBy });
    },
    [commit, state],
  );
  const setSort = useCallback(
    (sort: readonly ViewSortTerm[]): void => {
      commit({ ...state, sort });
    },
    [commit, state],
  );
  const reset = useCallback((): void => {
    commit({ filters: [], groupBy: null, sort: [] });
  }, [commit]);

  return { state, setFilters, setGroupBy, setSort, reset };
}
