'use client';

/** Query and mutations for native Project dependency links. */
import type { ProjectDependencyCreated, ProjectDependencyOut } from './contracts/project';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { api } from './api';
import { projectWorkSectionsDef } from './fetch-project-sections';
import { userErrorMessage } from './problem';
import { apiQueryOptions, unwrap, useApiMutation, useApiQuery } from './query';
import { invalidateWorkTargetQueries } from './work-target-invalidation';

/** Direction relative to the Project currently on screen. */
export type ProjectDependencyDirection = 'blockedBy' | 'blocking';

/** Data and actions exposed to the Project dependency panel. */
export interface ProjectDependencies {
  dependencies: ProjectDependencyOut;
  loading: boolean;
  error: string | null;
  add: (direction: ProjectDependencyDirection, otherProjectId: string) => void;
  remove: (otherProjectId: string) => void;
  pending: boolean;
  mutationError: string | null;
}

/** Read and edit dependency edges for one Project without leaving its detail view. */
export function useProjectDependencies(orgId: string, projectId: string): ProjectDependencies {
  const queryClient = useQueryClient();
  // Derived from the two ids this hook already has, the same way the milestone hooks derive theirs.
  // Threading the project-detail key in as a prop asked the page to hand down something every
  // consumer can build, and left two panels on one tab answering that question differently.
  const dependencyKey = useMemo(
    () => [...projectWorkSectionsDef(orgId, projectId).queryKey, 'dependencies'] as const,
    [orgId, projectId],
  );
  const query = useApiQuery(
    apiQueryOptions(
      dependencyKey,
      () =>
        api.v1.orgs[':orgId'].projects[':id'].dependencies.$get({
          param: { orgId, id: projectId },
        }),
      'Could not load project dependencies.',
    ),
  );
  const addMutation = useApiMutation<
    ProjectDependencyCreated,
    { direction: ProjectDependencyDirection; otherProjectId: string }
  >({
    mutationFn: ({ direction, otherProjectId }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].projects[':id'].dependencies.$post({
            param: { orgId, id: projectId },
            json:
              direction === 'blockedBy'
                ? { blockingProjectId: otherProjectId }
                : { blockedProjectId: otherProjectId },
          }),
        'Could not add the project dependency.',
      ),
    onSettled: () => {
      void invalidateWorkTargetQueries(queryClient, {
        target: 'project',
        ownerOrganizationId: orgId,
      });
    },
  });
  const removeMutation = useApiMutation<unknown, string>({
    mutationFn: (otherProjectId) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].projects[':id'].dependencies[':depId'].$delete({
            param: { orgId, id: projectId, depId: otherProjectId },
          }),
        'Could not remove the project dependency.',
      ),
    onSettled: () => {
      void invalidateWorkTargetQueries(queryClient, {
        target: 'project',
        ownerOrganizationId: orgId,
      });
    },
  });

  return {
    dependencies: query.data ?? { blocking: [], blockedBy: [] },
    loading: query.isPending,
    error: query.isError
      ? userErrorMessage(query.error, 'Could not load project dependencies.')
      : null,
    add: (direction, otherProjectId) => {
      addMutation.mutate({ direction, otherProjectId });
    },
    remove: removeMutation.mutate,
    pending: addMutation.isPending || removeMutation.isPending,
    mutationError: addMutation.error
      ? userErrorMessage(addMutation.error, 'Could not add the project dependency.')
      : removeMutation.error
        ? userErrorMessage(removeMutation.error, 'Could not remove the project dependency.')
        : null,
  };
}
