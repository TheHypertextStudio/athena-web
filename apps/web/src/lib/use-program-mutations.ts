import {
  ActorId,
  type Health,
  type ProgramDetailAggregate,
  type ProgramDetail,
  type ProgramOut,
  type ProgramStatus,
  ProgramSubjectRef,
  type ProgramUpdate,
  type Visibility,
} from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { api } from './api';
import { userErrorMessage } from './problem';
import { queryKeys, unwrap, useApiMutation } from './query';

/** ProgramPatch describes the use program mutations data contract shared by the hook or component. */
export interface ProgramPatch {
  /** New name. Non-empty; the name cannot be cleared. */
  name?: string | undefined;
  ownerId?: string | null | undefined;
  status?: ProgramStatus | undefined;
  health?: Health | null | undefined;
  visibility?: Visibility | undefined;
  /**
   * The plain-text summary/subtitle. Optional-not-nullable on the wire: send an empty string to
   * clear it (never `null`); omit to leave it unchanged.
   */
  summary?: string | undefined;
  /** The Markdown description/brief. `null` clears it. */
  description?: string | null | undefined;
}

function toProgramPatchBody(patch: ProgramPatch): ProgramUpdate {
  return {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
    ...(patch.ownerId !== undefined
      ? { ownerId: patch.ownerId === null ? null : ActorId.parse(patch.ownerId) }
      : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.health !== undefined ? { health: patch.health } : {}),
    ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
  };
}

/** ProgramMutations describes the use program mutations data contract shared by the hook or component. */
export interface ProgramMutations {
  patchProgram: (patch: ProgramPatch) => void;
  /** Post an update; the promise settles with the write so the composer can clear only on success. */
  postUpdate: (body: string, health: Health | undefined) => Promise<void>;
  propsPending: boolean;
  propsError: string | null;
  updatePosting: boolean;
  updateError: string | null;
}

/** useProgramMutations coordinates use program mutations state, loading, and mutations for its screen. */
export function useProgramMutations(
  orgId: string,
  programId: string,
  programLabel: string,
  aggregateKey: readonly unknown[],
  updatesKey: readonly unknown[],
): ProgramMutations {
  const queryClient = useQueryClient();
  const subject = ProgramSubjectRef.parse({ subjectType: 'program', subjectId: programId });
  const programsKey = useMemo(() => queryKeys.programs(orgId), [orgId]);

  const patchCachedProgram = useCallback(
    (apply: (program: ProgramDetail) => ProgramDetail): ProgramDetailAggregate | undefined => {
      const previous = queryClient.getQueryData<ProgramDetailAggregate>(aggregateKey);
      queryClient.setQueryData<ProgramDetailAggregate>(aggregateKey, (current) => {
        if (!current) return current;
        const program = apply(current.defaultView.program);
        return {
          ...current,
          snapshot: {
            ...current.snapshot,
            name: program.name,
          },
          defaultView: { program },
        };
      });
      return previous;
    },
    [queryClient, aggregateKey],
  );

  const postUpdateM = useApiMutation({
    mutationFn: ({ body, health }: { body: string; health: Health | undefined }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].updates.$post({
            param: { orgId },
            json: {
              ...subject,
              body,
              ...(health ? { health } : {}),
            },
          }),
        'Could not post your update.',
      ),
    onSuccess: (_created, { health }) => {
      if (health) patchCachedProgram((cur) => ({ ...cur, health }));
    },
    invalidateKeys: [updatesKey, aggregateKey],
  });

  const patch = useApiMutation<
    ProgramOut,
    ProgramPatch,
    { previous?: ProgramDetailAggregate | undefined }
  >({
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
      await queryClient.cancelQueries({ queryKey: aggregateKey as string[] });
      const body = toProgramPatchBody(patchBody);
      const previous = patchCachedProgram((cur) => Object.assign({}, cur, body));
      return { previous };
    },
    onError: (_err, _body, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(aggregateKey as string[], ctx.previous);
    },
    onSuccess: (updated) => {
      patchCachedProgram((cur) => ({ ...cur, ...updated, rollup: cur.rollup }));
    },
    // The Resources tab's derived sections are a projection of this record's prose, and the query
    // cache survives a reload — so without this, adding a mention to the description leaves that
    // tab showing the pre-edit answer until the staleness tier happens to expire.
    invalidateKeys: [
      aggregateKey,
      programsKey,
      queryKeys.entityMentions(orgId, 'program', programId),
    ],
  });

  return {
    patchProgram: patch.mutate,
    postUpdate: async (body, health) => {
      await postUpdateM.mutateAsync({ body, health });
    },
    propsPending: patch.isPending,
    propsError: patch.error
      ? userErrorMessage(patch.error, 'Could not update this program.')
      : null,
    updatePosting: postUpdateM.isPending,
    updateError: postUpdateM.error
      ? userErrorMessage(postUpdateM.error, 'Could not post that update.')
      : null,
  };
}
