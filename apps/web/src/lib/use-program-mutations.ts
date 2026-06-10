import {
  ActorId,
  type Health,
  type ProgramDetail,
  type ProgramOut,
  type ProgramStatus,
  type ProgramUpdate,
  type Visibility,
} from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { api } from './api';
import type { ProgramDetailData } from './fetch-program-detail';
import { queryKeys, unwrap, useApiMutation } from './query';

export interface ProgramPatch {
  ownerId?: string | null;
  status?: ProgramStatus;
  health?: Health | null;
  visibility?: Visibility;
}

function toProgramPatchBody(patch: ProgramPatch): ProgramUpdate {
  return {
    ...(patch.ownerId !== undefined
      ? { ownerId: patch.ownerId === null ? null : ActorId.parse(patch.ownerId) }
      : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.health !== undefined ? { health: patch.health } : {}),
    ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
  };
}

export interface ProgramMutations {
  patchProgram: (patch: ProgramPatch) => void;
  postUpdate: (body: string, health: Health | undefined) => void;
  propsPending: boolean;
  propsError: string | null;
  updatePosting: boolean;
  updateError: string | null;
}

export function useProgramMutations(
  orgId: string,
  programId: string,
  programLabel: string,
  detailKey: readonly unknown[],
  updatesKey: readonly unknown[],
): ProgramMutations {
  const queryClient = useQueryClient();
  const programsKey = useMemo(() => queryKeys.programs(orgId), [orgId]);

  const patchCachedProgram = useCallback(
    (apply: (program: ProgramDetail) => ProgramDetail): ProgramDetailData | undefined => {
      const previous = queryClient.getQueryData<ProgramDetailData>(detailKey);
      queryClient.setQueryData<ProgramDetailData>(detailKey, (cur) =>
        cur ? { ...cur, program: apply(cur.program) } : cur,
      );
      return previous;
    },
    [queryClient, detailKey],
  );

  const postUpdateM = useApiMutation({
    mutationFn: ({ body, health }: { body: string; health: Health | undefined }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].updates.$post({
            param: { orgId },
            json: {
              subjectType: 'program',
              subjectId: programId,
              body,
              ...(health ? { health } : {}),
            },
          }),
        'Could not post your update.',
      ),
    onSuccess: (_created, { health }) => {
      if (health) patchCachedProgram((cur) => ({ ...cur, health }));
    },
    invalidateKeys: [updatesKey, detailKey],
  });

  const patch = useApiMutation<ProgramOut, ProgramPatch, { previous?: ProgramDetailData }>({
    mutationFn: (patchBody) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].programs[':id'].$patch({
            param: { orgId, id: programId },
            json: toProgramPatchBody(patchBody),
          }),
        `Could not update this ${programLabel.toLowerCase()}.`,
      ),
    onMutate: async (patchBody) => {
      await queryClient.cancelQueries({ queryKey: detailKey as string[] });
      const body = toProgramPatchBody(patchBody);
      const previous = patchCachedProgram((cur) => ({ ...cur, ...body }));
      return { previous };
    },
    onError: (_err, _body, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(detailKey as string[], ctx.previous);
    },
    onSuccess: (updated) => {
      patchCachedProgram((cur) => ({ ...cur, ...updated, rollup: cur.rollup }));
    },
    invalidateKeys: [detailKey, programsKey],
  });

  return {
    patchProgram: patch.mutate,
    postUpdate: (body, health) => {
      postUpdateM.mutate({ body, health });
    },
    propsPending: patch.isPending,
    propsError: patch.error?.message ?? null,
    updatePosting: postUpdateM.isPending,
    updateError: postUpdateM.error?.message ?? null,
  };
}
