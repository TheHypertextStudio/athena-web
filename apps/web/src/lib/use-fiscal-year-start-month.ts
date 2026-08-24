'use client';

import { api } from './api';
import { useCallback } from 'react';
import { apiQueryOptions, queryKeys, useApiQuery } from './query';

/** Current fiscal-calendar state used by new Project and Initiative planning selections. */
export interface FiscalYearStartMonthState {
  /** Zero-based fiscal start month. January is used only while the workspace setting loads. */
  readonly fiscalYearStartMonth: number;
  /** Whether the picker must remain disabled to avoid committing against the fallback month. */
  readonly loading: boolean;
  /** Application-owned read error shown beside the disabled planning control. */
  readonly error: string | null;
  /** Retry the planning-calendar settings request. */
  readonly retry: () => void;
}

/**
 * Read the current workspace fiscal start month through the shared settings query.
 *
 * @param orgId - Workspace whose planning calendar applies.
 * @param enabled - Whether the settings request should run.
 * @returns Current month plus its loading state.
 */
export function useFiscalYearStartMonth(orgId: string, enabled = true): FiscalYearStartMonthState {
  const settings = useApiQuery({
    ...apiQueryOptions(
      queryKeys.settings(orgId, 'work-structure'),
      () =>
        api.v1.orgs[':orgId'].settings['work-structure'].$get({
          param: { orgId },
        }),
      'Could not load planning calendar settings.',
    ),
    enabled,
  });
  const retry = useCallback((): void => {
    void settings.refetch();
  }, [settings]);
  return {
    fiscalYearStartMonth: settings.data?.fiscalYearStartMonth ?? 0,
    loading: enabled && settings.data === undefined,
    error: settings.isError ? 'Could not load planning calendar settings.' : null,
    retry,
  };
}
