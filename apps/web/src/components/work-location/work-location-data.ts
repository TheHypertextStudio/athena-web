'use client';

/** Typed TanStack Query definitions for the personal work-location source of truth. */
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, STALE } from '@/lib/query';

/** Resolve independent current and expected location at one instant. */
export function workLocationPointDef(at: string) {
  return apiQueryOptions(
    queryKeys.workLocationPoint(at),
    () => api.v1.me['work-location'].$get({ query: { at } }),
    'Could not load your current work location.',
    { staleTime: STALE.volatile },
  );
}

/** Resolve non-overlapping expected-location segments in a half-open instant range. */
export function workLocationRangeDef(start: string, end: string) {
  return apiQueryOptions(
    queryKeys.workLocationRange(start, end),
    () => api.v1.me['work-location'].range.$get({ query: { start, end } }),
    'Could not load your expected work locations.',
    { staleTime: STALE.volatile },
  );
}

/** Load arbitrary saved places and independent profile designations. */
export function workLocationPlacesDef() {
  return apiQueryOptions(
    queryKeys.workLocationPlaces(),
    () => api.v1.me['work-location'].places.$get(),
    'Could not load your saved work places.',
    { staleTime: STALE.standard },
  );
}

/** Load active canonical one-off and weekly assertions. */
export function workLocationAssertionsDef() {
  return apiQueryOptions(
    queryKeys.workLocationAssertions(),
    () => api.v1.me['work-location'].assertions.$get(),
    'Could not load your work-location schedule.',
    { staleTime: STALE.standard },
  );
}

/** Load provider capability, bootstrap, and eventual-delivery state. */
export function workLocationSyncDef() {
  return apiQueryOptions(
    queryKeys.workLocationSync(),
    () => api.v1.me['work-location']['sync-state'].$get(),
    'Could not load work-location sync status.',
    { staleTime: STALE.volatile },
  );
}
