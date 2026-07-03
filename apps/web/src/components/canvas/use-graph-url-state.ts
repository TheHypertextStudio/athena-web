'use client';

/**
 * `components/canvas/use-graph-url-state` — bind the canvas filter/layout to the URL.
 *
 * @remarks
 * A thin wrapper over the pure {@link parseGraphUrl}/{@link serializeGraphUrl} codec (mirroring
 * `components/views/use-view-state.ts`): the URL is the source of truth, reads come from
 * `useSearchParams`, and writes go through `router.replace(..., { scroll: false })` so a filtered/
 * arranged graph is a shareable, reload-sticky link without pushing history entries.
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

import type { GraphFilter } from './graph-toolbar';
import { type GraphUrlState, parseGraphUrl, serializeGraphUrl } from './graph-url';
import type { LayoutDirection } from './use-dagre-layout';

/** The URL-backed filter/layout state + setters. */
export interface GraphUrlBinding {
  /** The current filter (decoded from the URL). */
  filter: GraphFilter;
  /** The current layout direction (decoded from the URL). */
  direction: LayoutDirection;
  /** Replace the filter, preserving the layout + unrelated params. */
  setFilter: (filter: GraphFilter) => void;
  /** Replace the layout direction, preserving the filter + unrelated params. */
  setDirection: (direction: LayoutDirection) => void;
}

/** Bind the canvas filter + layout to the URL search params. */
export function useGraphUrlState(): GraphUrlBinding {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { filter, direction } = useMemo(
    () => parseGraphUrl(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const write = useCallback(
    (next: GraphUrlState) => {
      const params = serializeGraphUrl(next, new URLSearchParams(searchParams.toString()));
      const query = params.toString();
      router.replace(query.length > 0 ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const setFilter = useCallback(
    (nextFilter: GraphFilter) => {
      write({ filter: nextFilter, direction });
    },
    [write, direction],
  );
  const setDirection = useCallback(
    (nextDirection: LayoutDirection) => {
      write({ filter, direction: nextDirection });
    },
    [write, filter],
  );

  return { filter, direction, setFilter, setDirection };
}
