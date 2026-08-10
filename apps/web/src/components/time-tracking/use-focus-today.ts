'use client';

/** Focus-sized access to today's personal Time Ledger. */
import type { TimeRecordOut } from '@docket/types';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, STALE, useApiQuery } from '@/lib/query';

/** A local calendar day represented as the API's half-open ISO range. */
export function focusTodayBounds(date = new Date()): { start: string; end: string } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Today's time data exposed to Focus surfaces. */
export interface FocusTodayData {
  readonly records: readonly TimeRecordOut[];
  readonly isPending: boolean;
  readonly error: string | null;
}

/** The start of a record's newest real human segment, with its record start as a safe fallback. */
function latestHumanStart(record: TimeRecordOut): number {
  let latest = record.startedAt ? Date.parse(record.startedAt) : 0;
  for (const interval of record.intervals) {
    if (interval.actorKind !== 'human') continue;
    if (interval.mode !== 'human_active') continue;
    if (interval.supersededById !== null) continue;
    const startedAt = Date.parse(interval.startedAt);
    if (!Number.isNaN(startedAt)) latest = Math.max(latest, startedAt);
  }
  return Number.isNaN(latest) ? 0 : latest;
}

/** Read the real sessions recorded during the caller's current local day. */
export function useFocusToday(): FocusTodayData {
  const bounds = focusTodayBounds();
  const query = useApiQuery(
    apiQueryOptions(
      queryKeys.timeTimeline(`${bounds.start}|${bounds.end}`),
      () => api.v1.time.timeline.$get({ query: bounds }),
      'Could not load today’s time.',
      { staleTime: STALE.volatile },
    ),
  );
  const records = [...(query.data?.items ?? [])].sort(
    (left, right) => latestHumanStart(right) - latestHumanStart(left),
  );
  return {
    records,
    isPending: query.isPending,
    error: query.isError ? userErrorMessage(query.error, 'Could not load today’s time.') : null,
  };
}
