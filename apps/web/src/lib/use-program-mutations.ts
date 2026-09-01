import { ActorId } from '@docket/identity-access/ids';
import { type Health, type Visibility } from '@docket/work/capability-contract';
import { type ProgramDetailAggregate } from './contracts/detail-aggregate';
import {
  type ProgramDetail,
  type ProgramOut,
  type ProgramStatus,
  type ProgramUpdate,
} from '@docket/work/program-contract';
import { ProgramStatusKey } from '@docket/work/work-view-contract';
import { ProgramSubjectRef } from '@docket/work/subject-ref-contract';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { api } from './api';
import { userErrorMessage } from './problem';
import { queryKeys, unwrap, useApiMutation } from './query';
import { invalidateWorkTargetQueries } from './work-target-invalidation';

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

/** The delete controls exposed to a Program detail surface. */
export interface ProgramDeleteMutation {
  /** Delete the Program and run a caller-owned dialog completion after success. */
  deleteProgram: (onSuccess?: () => void) => void;
  /** Clear a prior delete error before the confirmation dialog reopens. */
  reset: () => void;
  /** Application-owned delete error copy, or `null` before and after a successful write. */
  error: string | null;
  /** Whether the delete request is still unsettled. */
  pending: boolean;
}

/**
 * Apply one Program change to the aggregate cache without letting the local navigation identity
 * diverge from the default document.
 *
 * @param current - The aggregate currently cached for the Program, if any.
 * @param apply - The Program document update to apply.
 * @returns The aligned aggregate, or `undefined` when no aggregate has been cached.
 */
export function patchProgramAggregate(
  current: ProgramDetailAggregate | undefined,
  apply: (program: ProgramDetail) => ProgramDetail,
): ProgramDetailAggregate | undefined {
  if (!current) return undefined;
  const program = apply(current.defaultView.program);
  return {
    ...current,
    snapshot: {
      ...current.snapshot,
      name: program.name,
      status: ProgramStatusKey.parse(program.status),
      health: program.health ?? null,
    },
    defaultView: { program },
  };
}

/** useProgramMutations coordinates use program mutations state, loading, and mutations for its screen. */
export function useProgramMutations(
  orgId: string,
  programId: string,
  programLabel: string,
  aggregateKey: readonly unknown[],
): ProgramMutations {
  const queryClient = useQueryClient();
  const subject = ProgramSubjectRef.parse({ subjectType: 'program', subjectId: programId });
  const invalidateProgram = useCallback((): void => {
    void invalidateWorkTargetQueries(queryClient, {
      target: 'program',
      ownerOrganizationId: orgId,
    });
  }, [orgId, queryClient]);

  const patchCachedProgram = useCallback(
    (apply: (program: ProgramDetail) => ProgramDetail): ProgramDetailAggregate | undefined => {
      const previous = queryClient.getQueryData<ProgramDetailAggregate>(aggregateKey);
      queryClient.setQueryData<ProgramDetailAggregate>(aggregateKey, (current) =>
        patchProgramAggregate(current, apply),
      );
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
    onSettled: invalidateProgram,
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
    invalidateKeys: [queryKeys.entityMentions(orgId, 'program', programId)],
    onSettled: invalidateProgram,
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

/**
 * Delete one Program and reconcile every route that can project it.
 *
 * @param orgId - Workspace that owns the Program.
 * @param programId - Program being deleted.
 * @param programLabel - Active vocabulary label used in application-owned errors.
 * @param onDeleted - Navigation or other page-owned work after confirmed deletion.
 * @returns Confirmation-dialog controls backed by the shared mutation layer.
 */
export function useProgramDeleteMutation(
  orgId: string,
  programId: string,
  programLabel: string,
  onDeleted: () => void,
): ProgramDeleteMutation {
  const queryClient = useQueryClient();
  const deletion = useApiMutation({
    mutationFn: () =>
      unwrap(
        () => api.v1.orgs[':orgId'].programs[':id'].$delete({ param: { orgId, id: programId } }),
        `Could not delete this ${programLabel.toLowerCase()}.`,
      ),
    onSuccess: onDeleted,
    onSettled: () => {
      void invalidateWorkTargetQueries(queryClient, {
        target: 'program',
        ownerOrganizationId: orgId,
      });
    },
  });

  return {
    deleteProgram: (onSuccess) => {
      deletion.mutate(undefined, onSuccess === undefined ? undefined : { onSuccess });
    },
    reset: deletion.reset,
    error: deletion.error
      ? userErrorMessage(deletion.error, `Could not delete this ${programLabel.toLowerCase()}.`)
      : null,
    pending: deletion.isPending,
  };
}
