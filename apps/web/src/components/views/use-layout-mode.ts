'use client';

/**
 * `views` — which shape a list draws itself in, held in the URL beside the rest of the view state.
 *
 * @remarks
 * Deliberately **not** part of {@link import('./field-catalog').ViewDisplayState}. That type is the
 * timeline's geometry model, and `DISPLAY_GEOMETRY_TOKEN` is exhaustive over it by construction so
 * every option declares which of `row` / `bar` / `axis` it moves. Layout moves none of them — it
 * chooses a different renderer entirely — so adding it there would have meant inventing a fourth
 * token that means "not geometry", which is how a model stops being able to enforce anything.
 *
 * It rides the same URL as the rest of the view state, so a hub someone left in list layout is
 * still in list layout after a reload and arrives that way when the link is shared.
 */
import { useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';

import { useAppPathname, useAppSearchParams } from '@/lib/app-location';

/** The layouts a list can draw itself in. */
export type LayoutMode = 'cards' | 'list';

/** The search-param key the layout is persisted under. */
const LAYOUT_PARAM = 'layout';

/** The value returned by {@link useLayoutMode}. */
export interface UseLayoutModeResult {
  /** The active layout. */
  layout: LayoutMode;
  /** Switch layouts, rewriting the URL without adding a history entry. */
  setLayout: (layout: LayoutMode) => void;
}

/**
 * Hold a list's layout in the URL.
 *
 * @remarks
 * An unrecognized or absent `layout` param resolves to `fallback` rather than throwing, because a
 * hand-edited URL is a normal thing for someone to do and a broken screen is a bad answer to it.
 *
 * @param fallback - The layout to use when the URL says nothing. Each surface picks its own.
 * @returns The {@link UseLayoutModeResult}.
 */
export function useLayoutMode(fallback: LayoutMode): UseLayoutModeResult {
  const router = useRouter();
  const pathname = useAppPathname();
  const searchParams = useAppSearchParams();
  const search = searchParams.toString();

  const layout = useMemo<LayoutMode>(() => {
    const raw = new URLSearchParams(search).get(LAYOUT_PARAM);
    return raw === 'cards' || raw === 'list' ? raw : fallback;
  }, [search, fallback]);

  const setLayout = useCallback(
    (next: LayoutMode): void => {
      const params = new URLSearchParams(search);
      // The default stays out of the URL, so a link to an untouched hub has no layout param to
      // explain and the fallback remains the single place the default is stated.
      if (next === fallback) {
        params.delete(LAYOUT_PARAM);
      } else {
        params.set(LAYOUT_PARAM, next);
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [fallback, pathname, router, search],
  );

  return { layout, setLayout };
}
