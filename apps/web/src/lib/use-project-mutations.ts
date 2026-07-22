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
  type Health,
  LabelId,
  type ProjectOut,
  type ProjectStatus,
  type ProjectUpdate,
  ProgramId,
  ProjectId,
} from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';

import { api } from './api';
import type { ProjectDetailData } from './fetch-project-detail';
import { userErrorMessage } from './problem';
import { queryKeys, unwrap, useApiMutation } from './query';

/** The unbranded properties-panel patch surface. */
export interface ProjectPatch {
  /** New name. Non-empty; the name cannot be cleared. */
  name?: string;
  summary?: string | null;
  description?: string | null;
  health?: Health | null;
  leadId?: string | null;
  status?: ProjectStatus;
  startDate?: string | null;
  targetDate?: string | null;
  programId?: string | null;
  labelIds?: readonly string[];
}

function toProjectPatchBody(patch: ProjectPatch): ProjectUpdate {
  return {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    // The editor emits `null` on clear; the Update DTO is optional-not-nullable, so a cleared
    // field travels as an empty string (the server normalizes `''` back to NULL).
    ...(patch.summary !== undefined ? { summary: patch.summary ?? '' } : {}),
    ...(patch.description !== undefined ? { description: patch.description ?? '' } : {}),
    ...(patch.health !== undefined ? { health: patch.health } : {}),
    ...(patch.leadId !== undefined
      ? { leadId: patch.leadId === null ? null : ActorId.parse(patch.leadId) }
      : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
    ...(patch.targetDate !== undefined ? { targetDate: patch.targetDate } : {}),
    ...(patch.programId !== undefined
      ? { programId: patch.programId === null ? null : ProgramId.parse(patch.programId) }
      : {}),
    ...(patch.labelIds !== undefined
      ? { labelIds: patch.labelIds.map((labelId) => LabelId.parse(labelId)) }
      : {}),
  };
}

/** Stable callbacks + pending/error state for all project-detail writes. */
export interface ProjectMutations {
  patchProject: (patch: ProjectPatch) => void;
  setInitiatives: (initiativeIds: readonly string[]) => void;
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
      if (patchBody.labelIds !== undefined) {
        const selected = new Set(patchBody.labelIds);
        queryClient.setQueryData<ProjectDetailData>(detailKey, (cur) =>
          cur
            ? { ...cur, labels: cur.availableLabels.filter((item) => selected.has(item.id)) }
            : cur,
        );
      }
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

  // The initiative set immediately before the in-flight toggle's optimistic write, so the
  // mutation diffs against what the server actually has — not the cache, which onMutate has
  // already overwritten with `nextInitiativeIds` by the time mutationFn runs.
  const initiativeIdsBeforeMutate = useRef<readonly string[]>([]);

  const initiativeM = useApiMutation<
    undefined,
    readonly string[],
    { previous?: ProjectDetailData }
  >({
    mutationFn: async (nextInitiativeIds) => {
      const current = initiativeIdsBeforeMutate.current;
      const nextSet = new Set(nextInitiativeIds);
      const currentSet = new Set(current);
      const removed = current.filter((initiativeId) => !nextSet.has(initiativeId));
      const added = nextInitiativeIds.filter((initiativeId) => !currentSet.has(initiativeId));
      for (const initiativeId of removed) {
        await unwrap(
          () =>
            api.v1.orgs[':orgId'].initiatives[':id'].projects[':projectId'].$delete({
              param: { orgId, id: initiativeId, projectId },
            }),
          'Could not update the association.',
        );
      }
      for (const initiativeId of added) {
        await unwrap(
          () =>
            api.v1.orgs[':orgId'].initiatives[':id'].projects.$post({
              param: { orgId, id: initiativeId },
              json: { projectId: ProjectId.parse(projectId) },
            }),
          'Could not update the association.',
        );
      }
      return undefined;
    },
    onMutate: async (nextInitiativeIds) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<ProjectDetailData>(detailKey);
      initiativeIdsBeforeMutate.current = previous?.initiativeIds ?? [];
      queryClient.setQueryData<ProjectDetailData>(detailKey, (cur) =>
        cur ? { ...cur, initiativeIds: [...nextInitiativeIds].sort() } : cur,
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
    setInitiatives: initiativeM.mutate,
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
