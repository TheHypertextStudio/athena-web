'use client';

import type { HubTodayOut } from '@docket/types';
import { useContextState } from '@docket/ui/components';
import { useMemo } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import { todayISODate } from '@/lib/today';
import { userErrorMessage } from '@/lib/problem';

/** All data + state the Today page needs from the data layer. */
export interface TodayPageData {
  data: HubTodayOut | null;
  loading: boolean;
  error: string | null;
  /** Force a re-fetch (error-state retry, or after a task is captured). */
  refetch: () => void;
  activeOrgId: string | null;
  orgName: (orgId: string) => string;
  heading: string;
}

/**
 * Coordinates the Today screen's data via the shared {@link useApiQuery} layer: it auto-refetches
 * on window focus and after its 30s stale window, so the page needs no manual Refresh control.
 */
export function useTodayData(): TodayPageData {
  const { orgName } = useActiveOrg();
  const { activeOrgId } = useContextState();

  const date = todayISODate();
  const todayQ = useApiQuery(
    apiQueryOptions(
      queryKeys.today(date),
      () => api.v1.hub.today.$get({ query: { date } }),
      'Could not load your day.',
    ),
  );
  const data = todayQ.data ?? null;

  const heading = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
    [],
  );

  return {
    data,
    loading: todayQ.isPending,
    error: todayQ.error ? userErrorMessage(todayQ.error, 'Could not load today.') : null,
    refetch: () => {
      void todayQ.refetch();
    },
    activeOrgId,
    orgName,
    heading,
  };
}
