import type {
  InitiativeHierarchyCandidateMode,
  InitiativeHierarchyCandidatesOut,
} from '@docket/types';

import type { api as ApiClient } from './api';
import { apiQueryOptions } from './query-core';
import { queryKeys } from './query-keys';

/**
 * Build the complete accessible Initiative candidate query for one hierarchy picker direction.
 *
 * @param orgId - Route workspace that owns the hierarchy projection.
 * @param mode - Whether the picker selects a parent or a child.
 * @param client - Typed API client supplied by the caller.
 * @param query - Optional server search term.
 * @returns A typed TanStack Query definition under the Initiative collection key.
 */
export function initiativeHierarchyCandidatesDef(
  orgId: string,
  mode: InitiativeHierarchyCandidateMode,
  client: typeof ApiClient,
  query = '',
) {
  const normalizedQuery = query.trim();
  return apiQueryOptions<InitiativeHierarchyCandidatesOut>(
    queryKeys.initiativeHierarchyCandidates(orgId, mode, normalizedQuery),
    () =>
      client.v1.orgs[':orgId'].initiatives['hierarchy-candidates'].$get({
        param: { orgId },
        query: {
          mode,
          ...(normalizedQuery.length === 0 ? {} : { query: normalizedQuery }),
        },
      }),
    'Could not load Initiative hierarchy choices.',
  );
}
