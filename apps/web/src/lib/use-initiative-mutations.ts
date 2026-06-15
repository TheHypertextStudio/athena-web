import {
  ActorId,
  type InitiativeDetail,
  type InitiativeOut,
  type InitiativeUpdate,
  ProgramId,
  ProjectId,
} from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { api } from './api';
import type { InitiativeDetailData } from './fetch-initiative-detail';
import { queryKeys, unwrap, useApiMutation } from './query';

/** InitiativePatch describes the use initiative mutations data contract shared by the hook or component. */
export interface InitiativePatch {
  ownerId?: string | null;
  targetDate?: string | null;
}

function toInitiativePatchBody(patch: InitiativePatch): InitiativeUpdate {
  return {
    ...(patch.ownerId !== undefined
      ? { ownerId: patch.ownerId === null ? null : ActorId.parse(patch.ownerId) }
      : {}),
    ...(patch.targetDate !== undefined ? { targetDate: patch.targetDate } : {}),
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
  const associationKeys = useMemo(
    () => [timelineKey, detailKey] as const,
    [timelineKey, detailKey],
  );

  const patchDetail = (
    apply: (d: InitiativeDetail) => InitiativeDetail,
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
        const previous = patchDetail((d) => ({ ...d, ...body }));
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
                  derivedStatus: cur.detail.derivedStatus,
                },
              }
            : cur,
        );
      },
      invalidateKeys: [detailKey],
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
    propsError: patch.error?.message ?? null,
    linkProgram: linkProgramM.mutate,
    unlinkProgram: unlinkProgramM.mutate,
    linkProject: linkProjectM.mutate,
    unlinkProject: unlinkProjectM.mutate,
    programBusy: linkProgramM.isPending || unlinkProgramM.isPending,
    projectBusy: linkProjectM.isPending || unlinkProjectM.isPending,
    programError: linkProgramM.error?.message ?? unlinkProgramM.error?.message ?? null,
    projectError: linkProjectM.error?.message ?? unlinkProjectM.error?.message ?? null,
  };
}
