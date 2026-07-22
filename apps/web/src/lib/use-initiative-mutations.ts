import {
  ActorId,
  type Health,
  type InitiativeAggregateDetail,
  type InitiativeOut,
  type InitiativePriority,
  type InitiativeStatus,
  type InitiativeUpdate,
  type InitiativeUpdateCadence,
  LabelId,
  ProgramId,
  ProjectId,
} from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { api } from './api';
import type { InitiativeDetailData } from './fetch-initiative-detail';
import { userErrorMessage } from './problem';
import { queryKeys, unwrap, useApiMutation } from './query';

/** InitiativePatch describes the use initiative mutations data contract shared by the hook or component. */
export interface InitiativePatch {
  name?: string;
  summary?: string | null;
  description?: string | null;
  ownerId?: string | null;
  status?: InitiativeStatus;
  health?: Health | null;
  priority?: InitiativePriority;
  updateCadence?: InitiativeUpdateCadence;
  targetDate?: string | null;
  labelIds?: string[];
}

function toInitiativePatchBody(patch: InitiativePatch): InitiativeUpdate {
  return {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    // The editor emits `null` on clear; the Update DTO is optional-not-nullable, so a cleared
    // field travels as an empty string (the server normalizes `''` back to NULL).
    ...(patch.summary !== undefined ? { summary: patch.summary ?? '' } : {}),
    ...(patch.description !== undefined ? { description: patch.description ?? '' } : {}),
    ...(patch.ownerId !== undefined
      ? { ownerId: patch.ownerId === null ? null : ActorId.parse(patch.ownerId) }
      : {}),
    ...(patch.targetDate !== undefined ? { targetDate: patch.targetDate } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.health !== undefined ? { health: patch.health } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.updateCadence !== undefined ? { updateCadence: patch.updateCadence } : {}),
    ...(patch.labelIds !== undefined
      ? { labelIds: patch.labelIds.map((id) => LabelId.parse(id)) }
      : {}),
  };
}

/** InitiativeMutations describes the use initiative mutations data contract shared by the hook or component. */
export interface InitiativeMutations {
  patchInitiative: (patch: InitiativePatch) => void;
  propsPending: boolean;
  propsError: string | null;
  linkProgram: (programId: string) => void;
  unlinkProgram: (programId: string) => void;
  linkProject: (projectId: string) => void;
  unlinkProject: (projectId: string) => void;
  programBusy: boolean;
  projectBusy: boolean;
  programError: string | null;
  projectError: string | null;
}

/** useInitiativeMutations coordinates use initiative mutations state, loading, and mutations for its screen. */
export function useInitiativeMutations(
  orgId: string,
  initiativeId: string,
  initiativeNounLower: string,
  programNounLower: string,
  projectNounLower: string,
): InitiativeMutations {
  const queryClient = useQueryClient();
  const detailKey = useMemo(() => queryKeys.initiative(orgId, initiativeId), [orgId, initiativeId]);
  const timelineKey = useMemo(() => [...detailKey, 'timeline'] as const, [detailKey]);
  const overviewKey = useMemo(() => queryKeys.initiatives(orgId), [orgId]);
  const associationKeys = useMemo(
    () => [timelineKey, detailKey, overviewKey] as const,
    [timelineKey, detailKey, overviewKey],
  );

  const patchDetail = (
    apply: (d: InitiativeAggregateDetail) => InitiativeAggregateDetail,
  ): InitiativeDetailData | undefined => {
    const previous = queryClient.getQueryData<InitiativeDetailData>(detailKey);
    queryClient.setQueryData<InitiativeDetailData>(detailKey, (cur) =>
      cur ? { ...cur, detail: apply(cur.detail) } : cur,
    );
    return previous;
  };

  const patch = useApiMutation<InitiativeOut, InitiativePatch, { previous?: InitiativeDetailData }>(
    {
      mutationFn: (patchBody) =>
        unwrap(
          () =>
            api.v1.orgs[':orgId'].initiatives[':id'].$patch({
              param: { orgId, id: initiativeId },
              json: toInitiativePatchBody(patchBody),
            }),
          `Could not update the ${initiativeNounLower}.`,
        ),
      onMutate: async (patchBody) => {
        await queryClient.cancelQueries({ queryKey: detailKey });
        const body = toInitiativePatchBody(patchBody);
        const cached = queryClient.getQueryData<InitiativeDetailData>(detailKey);
        const { labelIds, ...properties } = body;
        const previous = patchDetail((d) => ({
          ...d,
          ...properties,
          ...(labelIds
            ? { labels: (cached?.labels ?? []).filter((label) => labelIds.includes(label.id)) }
            : {}),
        }));
        return { previous };
      },
      onError: (_err, _body, ctx) => {
        if (ctx?.previous) queryClient.setQueryData(detailKey, ctx.previous);
      },
      onSuccess: (updated) => {
        queryClient.setQueryData<InitiativeDetailData>(detailKey, (cur) =>
          cur
            ? {
                ...cur,
                detail: {
                  ...cur.detail,
                  ...updated,
                  childMix: cur.detail.childMix,
                  distribution: cur.detail.distribution,
                  rolledUpHealth: cur.detail.rolledUpHealth,
                },
              }
            : cur,
        );
      },
      invalidateKeys: [detailKey, overviewKey],
    },
  );

  const linkProgramM = useApiMutation({
    mutationFn: (programId: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].initiatives[':id'].programs.$post({
            param: { orgId, id: initiativeId },
            json: { programId: ProgramId.parse(programId) },
          }),
        `Could not link the ${programNounLower}.`,
      ),
    invalidateKeys: associationKeys,
  });

  const unlinkProgramM = useApiMutation({
    mutationFn: (programId: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].initiatives[':id'].programs[':programId'].$delete({
            param: { orgId, id: initiativeId, programId },
          }),
        `Could not unlink the ${programNounLower}.`,
      ),
    invalidateKeys: associationKeys,
  });

  const linkProjectM = useApiMutation({
    mutationFn: (projectId: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].initiatives[':id'].projects.$post({
            param: { orgId, id: initiativeId },
            json: { projectId: ProjectId.parse(projectId) },
          }),
        `Could not link the ${projectNounLower}.`,
      ),
    invalidateKeys: associationKeys,
  });

  const unlinkProjectM = useApiMutation({
    mutationFn: (projectId: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].initiatives[':id'].projects[':projectId'].$delete({
            param: { orgId, id: initiativeId, projectId },
          }),
        `Could not unlink the ${projectNounLower}.`,
      ),
    invalidateKeys: associationKeys,
  });

  return {
    patchInitiative: patch.mutate,
    propsPending: patch.isPending,
    propsError: patch.error
      ? userErrorMessage(patch.error, 'Could not update this initiative.')
      : null,
    linkProgram: linkProgramM.mutate,
    unlinkProgram: unlinkProgramM.mutate,
    linkProject: linkProjectM.mutate,
    unlinkProject: unlinkProjectM.mutate,
    programBusy: linkProgramM.isPending || unlinkProgramM.isPending,
    projectBusy: linkProjectM.isPending || unlinkProjectM.isPending,
    programError: linkProgramM.error
      ? userErrorMessage(linkProgramM.error, 'Could not link that program.')
      : unlinkProgramM.error
        ? userErrorMessage(unlinkProgramM.error, 'Could not unlink that program.')
        : null,
    projectError: linkProjectM.error
      ? userErrorMessage(linkProjectM.error, 'Could not link that project.')
      : unlinkProjectM.error
        ? userErrorMessage(unlinkProjectM.error, 'Could not unlink that project.')
        : null,
  };
}
