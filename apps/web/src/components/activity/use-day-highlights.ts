'use client';

/**
 * `activity` — reads and writes for a narrated day.
 *
 * @remarks
 * Two deliberate choices here, both about not disturbing the surface the panel sits on.
 *
 * The query key lives under `['me','highlights']` rather than `['me','plan']`. Every mutation in the
 * end-of-day review invalidates the plan prefix, and the highlights panel renders *above* that
 * review's steps — sharing the prefix would re-read the review and re-render its step tree on every
 * debounced keystroke while somebody is mid-rewrite.
 *
 * Polling escalates only while narration is in flight and then stops, expressed as a functional
 * `refetchInterval` rather than by conditionally swapping to a live query, which would be a
 * conditional hook call.
 *
 * `date` is optional throughout, and omitting it means "today" — resolved by the server from the
 * person's Hub timezone rather than computed here from the browser clock. Those two disagree
 * whenever somebody travels or their Hub zone is set to somewhere they are not, and asking for the
 * browser's today from a zone behind it is asking for a day that has not happened yet, which the API
 * correctly refuses. The client has no business deciding which day it is.
 */
import type { HighlightPatch, HighlightsDayOut } from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import {
  STALE,
  apiQueryOptions,
  optimisticPatch,
  queryKeys,
  unwrap,
  useApiListQuery,
  useApiMutation,
} from '@/lib/query';

/** How often to re-read while sentences are still being written. */
const NARRATION_POLL_MS = 4_000;

/**
 * The read definition for one day.
 *
 * @remarks
 * Exported so a hover prefetch and the panel itself share one definition rather than two that can
 * disagree about staleness.
 *
 * @param date - An explicitly chosen local day (`YYYY-MM-DD`), or omitted for the caller's today.
 */
export function dayHighlightsDef(date?: string) {
  return apiQueryOptions<HighlightsDayOut>(
    // One key for "today" whichever surface asked, so arriving at the review from the day's entry
    // renders from cache instead of re-fetching the same day under a different name.
    queryKeys.dayHighlights(date ?? 'today'),
    () => api.v1.hub.highlights.$get({ query: date === undefined ? {} : { date } }),
    'Could not load what happened today.',
    {
      staleTime: STALE.standard,
      refetchInterval: (query) =>
        query.state.data?.generating === true ? NARRATION_POLL_MS : false,
    },
  );
}

/**
 * Read one narrated day.
 *
 * @param date - An explicitly chosen local day (`YYYY-MM-DD`), or omitted for the caller's today.
 */
export function useDayHighlights(date?: string) {
  // A list read, so a refetch keeps the previous day on screen instead of flashing a skeleton.
  return useApiListQuery(dayHighlightsDef(date));
}

/**
 * Change what one entry of a day says.
 *
 * @param date - The explicitly chosen day whose cache to patch, or omitted for the caller's today.
 */
export function useCurateHighlight(date?: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.dayHighlights(date ?? 'today');
  return useApiMutation<unknown, { id: string } & HighlightPatch>({
    mutationFn: (variables) =>
      unwrap(
        () =>
          api.v1.hub.highlights[':highlightId'].$patch({
            param: { highlightId: variables.id },
            json: {
              ...(variables.kept === undefined ? {} : { kept: variables.kept }),
              ...(variables.narration === undefined ? {} : { narration: variables.narration }),
            },
          }),
        'Could not save that change.',
      ),
    onMutate: (variables) =>
      optimisticPatch<HighlightsDayOut>(queryClient, key, (previous) => ({
        ...previous,
        highlights: previous.highlights.map((highlight) =>
          highlight.id === variables.id
            ? {
                ...highlight,
                ...(variables.kept === undefined ? {} : { kept: variables.kept }),
                ...(variables.narration === undefined
                  ? {}
                  : {
                      narration: {
                        ...highlight.narration,
                        // `null` reverts to the generated sentence, which the server still holds; the
                        // optimistic view cannot know it, so it waits for the settled read.
                        text: variables.narration ?? highlight.narration.text,
                        edited: variables.narration !== null,
                      },
                    }),
              }
            : highlight,
        ),
      })),
    invalidateKeys: [key],
  });
}
