/**
 * Mutation hook for the project detail page.
 *
 * @remarks
 * Encapsulates project property, initiative-association, and status-update writes with optimistic
 * cache helpers that keep the composite {@link ProjectDetailData} snapshot consistent
 * between the request and the server's settle-time read-back.
 */
import {
  ActorId,
  type ProjectOut,
  type ProjectStatus,
  type ProjectUpdate,
  ProgramId,
  ProjectId,
} from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { api } from './api';
import type { ProjectDetailData } from './fetch-project-detail';
import { userErrorMessage } from './problem';
import { queryKeys, unwrap, useApiMutation } from './query';

/** The unbranded properties-panel patch surface. */
export interface ProjectPatch {
  description?: string | null;
  leadId?: string | null;
  status?: ProjectStatus;
  startDate?: string | null;
  targetDate?: string | null;
  programId?: string | null;
}

function toProjectPatchBody(patch: ProjectPatch): ProjectUpdate {
  return {
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.leadId !== undefined
      ? { leadId: patch.leadId === null ? null : ActorId.parse(patch.leadId) }
      : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
    ...(patch.targetDate !== undefined ? { targetDate: patch.targetDate } : {}),
    ...(patch.programId !== undefined
      ? { programId: patch.programId === null ? null : ProgramId.parse(patch.programId) }
      : {}),
  };
}

/** Stable callbacks + pending/error state for all project-detail writes. */
export interface ProjectMutations {
  patchProject: (patch: ProjectPatch) => void;
  setInitiative: (initiativeId: string | null) => void;
  postUpdate: (body: string) => void;
  propsPending: boolean;
  propsError: string | null;
  updatePosting: boolean;
  updateError: string | null;
}

/**
 * All write operations for the project detail page.
 *
 * @param orgId - The active organization id.
 * @param projectId - The project being mutated.
 */
export function useProjectMutations(orgId: string, projectId: string): ProjectMutations {
  const queryClient = useQueryClient();
  const detailKey = useMemo(() => queryKeys.project(orgId, projectId), [orgId, projectId]);
  const updatesKey = useMemo(() => [...detailKey, 'updates'] as const, [detailKey]);

  const patchCachedProject = useCallback(
    (apply: (p: ProjectOut) => ProjectOut): ProjectDetailData | undefined => {
      const previous = queryClient.getQueryData<ProjectDetailData>(detailKey);
      queryClient.setQueryData<ProjectDetailData>(detailKey, (cur) =>
        cur && cur.project ? { ...cur, project: apply(cur.project) } : cur,
      );
      return previous;
    },
    [queryClient, detailKey],
  );

  const patch = useApiMutation<ProjectOut, ProjectPatch, { previous?: ProjectDetailData }>({
    mutationFn: (patchBody) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].projects[':id'].$patch({
            param: { orgId, id: projectId },
            json: toProjectPatchBody(patchBody),
          }),
        'Could not update the project.',
      ),
    onMutate: async (patchBody) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const body = toProjectPatchBody(patchBody);
      const previous = patchCachedProject((cur) => ({ ...cur, ...body }));
      return { previous };
    },
    onError: (_err, _body, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(detailKey, ctx.previous);
    },
    onSuccess: (updated) => {
      patchCachedProject(() => updated);
    },
    invalidateKeys: [detailKey, queryKeys.projects(orgId)],
  });

  const initiativeM = useApiMutation<undefined, string | null, { previous?: ProjectDetailData }>({
    mutationFn: async (nextInitiativeId) => {
      const current =
        queryClient.getQueryData<ProjectDetailData>(detailKey)?.currentInitiativeId ?? null;
      if (current === nextInitiativeId) return undefined;
      if (current) {
        await unwrap(
          () =>
            api.v1.orgs[':orgId'].initiatives[':id'].projects[':projectId'].$delete({
              param: { orgId, id: current, projectId },
            }),
          'Could not update the association.',
        );
      }
      if (nextInitiativeId) {
        await unwrap(
          () =>
            api.v1.orgs[':orgId'].initiatives[':id'].projects.$post({
              param: { orgId, id: nextInitiativeId },
              json: { projectId: ProjectId.parse(projectId) },
            }),
          'Could not update the association.',
        );
      }
      return undefined;
    },
    onMutate: async (nextInitiativeId) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<ProjectDetailData>(detailKey);
      queryClient.setQueryData<ProjectDetailData>(detailKey, (cur) =>
        cur ? { ...cur, currentInitiativeId: nextInitiativeId } : cur,
      );
      return { previous };
    },
    onError: (_err, _next, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(detailKey, ctx.previous);
    },
    invalidateKeys: [detailKey],
  });

  const updateM = useApiMutation({
    mutationFn: (body: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].updates.$post({
            param: { orgId },
            json: { subjectType: 'project', subjectId: projectId, body },
          }),
        'Could not post your update.',
      ),
    invalidateKeys: [updatesKey, detailKey],
  });

  return {
    patchProject: patch.mutate,
    setInitiative: initiativeM.mutate,
    postUpdate: updateM.mutate,
    propsPending: patch.isPending || initiativeM.isPending,
    propsError: patch.error
      ? userErrorMessage(patch.error, 'Could not update this project.')
      : initiativeM.error
        ? userErrorMessage(initiativeM.error, 'Could not update the linked initiative.')
        : null,
    updatePosting: updateM.isPending,
    updateError: updateM.error
      ? userErrorMessage(updateM.error, 'Could not post that update.')
      : null,
  };
}
