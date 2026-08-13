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
 * @param date - The local day (`YYYY-MM-DD`).
 */
export function dayHighlightsDef(date: string) {
  return apiQueryOptions<HighlightsDayOut>(
    queryKeys.dayHighlights(date),
    () => api.v1.hub.highlights.$get({ query: { date } }),
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
 * @param date - The local day (`YYYY-MM-DD`).
 */
export function useDayHighlights(date: string) {
  // A list read, so a refetch keeps the previous day on screen instead of flashing a skeleton.
  return useApiListQuery(dayHighlightsDef(date));
}

/**
 * Change what one entry of a day says.
 *
 * @param date - The local day whose cache to patch.
 */
export function useCurateHighlight(date: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.dayHighlights(date);
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
