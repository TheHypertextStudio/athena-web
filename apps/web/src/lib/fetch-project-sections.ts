/** Deferred, Project-scoped work content. */
import type { ProjectWorkSectionsOut } from '@docket/types';

import { api } from './api';
import { apiQueryOptions, queryKeys } from './query';

/** Read Project tasks and milestones only after the work surface opens. */
export function projectWorkSectionsDef(orgId: string, projectId: string) {
  return apiQueryOptions<ProjectWorkSectionsOut>(
    [...queryKeys.projectAggregate(orgId, projectId), 'work'] as const,
    () => api.v1.orgs[':orgId'].projects[':id'].work.$get({ param: { orgId, id: projectId } }),
    'Could not load Project work.',
    { staleTime: 60_000 },
  );
}
