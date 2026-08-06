'use client';

/**
 * `components/canvas/use-graph-display` — bind the canvas presentation options to the URL.
 *
 * @remarks
 * A thin wrapper over the pure {@link parseGraphDisplay}/{@link serializeGraphDisplay} codec,
 * mirroring `components/views/use-view-state.ts`: the URL is the source of truth, reads come from
 * `useSearchParams`, and writes go through `router.replace(…, { scroll: false })` so an arranged
 * graph is a shareable, reload-sticky link that does not pollute the back button.
 *
 * It sits *alongside* `useViewState` rather than replacing it. That hook owns the query — filters
 * and grouping, on the shared `filter`/`group` params — and this one owns presentation, on the
 * canvas's own keys. Neither codec touches the other's params, so the two compose on one URL.
 */
import { useRouter } from 'next/navigation';
import { useAppPathname, useAppSearchParams } from '@/lib/app-location';
import { useCallback, useMemo } from 'react';

import { type GraphDisplayState, parseGraphDisplay, serializeGraphDisplay } from './graph-display';

/** The URL-backed presentation state plus its setter. */
export interface GraphDisplayBinding {
  /** The current presentation options, decoded from the URL. */
  display: GraphDisplayState;
  /**
   * Patch one or more presentation options, preserving filters and unrelated params.
   *
   * @remarks
   * A patch rather than a whole-state setter: every caller changes one option at a time, and a
   * setter that takes the full state invites a stale read being written back over a concurrent
   * change.
   */
  patchDisplay: (patch: Partial<GraphDisplayState>) => void;
}

/** Bind the canvas presentation options to the URL search params. */
export function useGraphDisplay(): GraphDisplayBinding {
  const router = useRouter();
  const pathname = useAppPathname();
  const searchParams = useAppSearchParams();

  // Key the parse on the string form; `useSearchParams` returns a stable object whose contents
  // change without its identity doing so.
  const search = searchParams.toString();
  const display = useMemo(() => parseGraphDisplay(new URLSearchParams(search)), [search]);

  const setDisplay = useCallback(
    (next: GraphDisplayState) => {
      const params = serializeGraphDisplay(next, new URLSearchParams(search));
      const query = params.toString();
      router.replace(query.length > 0 ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [router, pathname, search],
  );

  const patchDisplay = useCallback(
    (patch: Partial<GraphDisplayState>) => {
      setDisplay({ ...display, ...patch });
    },
    [setDisplay, display],
  );

  return { display, patchDisplay };
}
