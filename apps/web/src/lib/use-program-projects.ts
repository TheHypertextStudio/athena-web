'use client';

/** Attach/detach mutations for filing Projects under a Program, from the Program's own page. */
import type { ProjectOut } from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';

import { api } from './api';
import { userErrorMessage } from './problem';
import { unwrap, useApiMutation } from './query';
import { invalidateWorkTargetQueries } from './work-target-invalidation';

/** Attach/detach actions exposed to the Program's Projects tab. */
export interface ProgramProjectsMutations {
  /** File an existing Project under this Program (sets its `programId`). */
  attach: (projectId: string) => void;
  /** Unfile a Project from this Program (clears its `programId`). */
  detach: (projectId: string) => void;
  pending: boolean;
  mutationError: string | null;
}

/**
 * File/unfile Projects under one Program by PATCHing each Project's `programId` — the same
 * mutation the Project's own Properties panel already calls, just triggered from the Program
 * side. Invalidates the org's shared projects roster (so every picker/list sees the change)
 * plus the Program's own detail read (its `rollup.projects` count).
 *
 * @param orgId - The active org.
 * @param programId - The Program Projects are being filed under/out of.
 */
export function useProgramProjects(orgId: string, programId: string): ProgramProjectsMutations {
  const queryClient = useQueryClient();
  const invalidateTargets = (): void => {
    void invalidateWorkTargetQueries(queryClient, {
      target: 'project',
      ownerOrganizationId: orgId,
    });
    void invalidateWorkTargetQueries(queryClient, {
      target: 'program',
      ownerOrganizationId: orgId,
    });
  };

  const attachMutation = useApiMutation<ProjectOut, string>({
    mutationFn: (projectId) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].projects[':id'].$patch({
            param: { orgId, id: projectId },
            json: { programId },
          }),
        'Could not add the project.',
      ),
    onSettled: invalidateTargets,
  });

  const detachMutation = useApiMutation<ProjectOut, string>({
    mutationFn: (projectId) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].projects[':id'].$patch({
            param: { orgId, id: projectId },
            json: { programId: null },
          }),
        'Could not remove the project.',
      ),
    onSettled: invalidateTargets,
  });

  return {
    attach: (projectId) => {
      attachMutation.mutate(projectId);
    },
    detach: (projectId) => {
      detachMutation.mutate(projectId);
    },
    pending: attachMutation.isPending || detachMutation.isPending,
    mutationError: attachMutation.error
      ? userErrorMessage(attachMutation.error, 'Could not add the project.')
      : detachMutation.error
        ? userErrorMessage(detachMutation.error, 'Could not remove the project.')
        : null,
  };
}
