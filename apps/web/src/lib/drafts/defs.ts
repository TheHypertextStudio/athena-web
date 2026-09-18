'use client';

/**
 * `lib/drafts/defs` — typed reads for the composer drafting system.
 *
 * @remarks
 * The resume-drafts preference lives in the caller's Hub preferences under `composer`. It is read
 * through the shared `hubPreferences` key so the Profile settings row and every composer see the
 * same cached value and the same invalidation after a PATCH.
 */
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, useLiveApiQuery } from '@/lib/query';

/** How often the preference read refreshes while a subscribed surface is on screen. */
const HUB_PREFERENCES_POLL_MS = 15_000;

/**
 * Whether opening a create composer should reopen the newest pending draft of that kind.
 *
 * @returns `true` only when the preference is stored as `true`; absent, loading, or failed reads
 * resolve to `false`, so the composer opens empty until the preference is known.
 */
export function useResumeDraftsPreference(): boolean {
  const preferencesQ = useLiveApiQuery(
    apiQueryOptions(
      queryKeys.hubPreferences(),
      () => api.v1.hub.preferences.$get(),
      'Could not load your preferences.',
    ),
    HUB_PREFERENCES_POLL_MS,
  );
  return preferencesQ.data?.composer?.resumeDrafts === true;
}
