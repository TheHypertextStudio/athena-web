/** Typed Project portfolio aggregate query definition. */
import { api } from './api';
import { apiQueryOptions, queryKeys } from './query';

/**
 * Build the shared Project overview query used by list, dependency, and timeline lenses.
 *
 * @param orgId - Active workspace identifier.
 * @returns A TanStack Query definition keyed with the Project collection.
 */
export function projectOverviewDef(orgId: string) {
  return apiQueryOptions(
    [...queryKeys.projects(orgId), 'overview'] as const,
    () => api.v1.orgs[':orgId'].projects.overview.$get({ param: { orgId } }),
    'Could not load projects.',
  );
}
