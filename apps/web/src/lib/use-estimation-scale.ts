import type { EstimationScale } from '@docket/types';

import { api } from './api';
import { apiQueryOptions, queryKeys, useApiQuery } from './query';

/** The workspace's configured task-estimation scale, or `null` while it loads. */
export interface EstimationScaleState {
  scale: EstimationScale | null;
  loading: boolean;
}

/**
 * Read the workspace's configured task-estimation scale (Settings > Work structure).
 *
 * @remarks
 * Shares the same query cache entry as the settings page itself
 * (`queryKeys.settings(orgId, 'work-structure')`), so a scale change made there is reflected in
 * every open estimate picker without a separate invalidation path.
 *
 * @param orgId - The active organization id.
 * @param enabled - Whether the destination is resolved and the query may run.
 */
export function useEstimationScale(orgId: string, enabled = true): EstimationScaleState {
  const settingsQ = useApiQuery({
    ...apiQueryOptions(
      queryKeys.settings(orgId, 'work-structure'),
      () => api.v1.orgs[':orgId'].settings['work-structure'].$get({ param: { orgId } }),
      'Could not load work structure settings.',
    ),
    enabled,
  });
  return {
    scale: settingsQ.data?.estimationScale ?? null,
    loading: enabled && settingsQ.isPending,
  };
}
