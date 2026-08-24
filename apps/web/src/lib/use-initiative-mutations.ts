import {
  ActorId,
  type Health,
  type InitiativeDetail,
  type InitiativeDetailAggregate,
  type InitiativeOut,
  type InitiativePriority,
  type InitiativeStatus,
  type InitiativeUpdate,
  type InitiativeUpdateCadence,
  InitiativeStatusKey,
  LabelId,
  ProgramId,
  ProjectId,
} from '@docket/types';
import type { DateResolution } from '@docket/work/planning-timeframe';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { api } from './api';
import { userErrorMessage } from './problem';
import { queryKeys, unwrap, useApiMutation } from './query';

/** InitiativePatch describes the use initiative mutations data contract shared by the hook or component. */
export interface InitiativePatch {
  name?: string | undefined;
  summary?: string | null | undefined;
  description?: string | null | undefined;
  ownerId?: string | null | undefined;
  status?: InitiativeStatus | undefined;
  health?: Health | null | undefined;
  priority?: InitiativePriority | undefined;
  updateCadence?: InitiativeUpdateCadence | undefined;
  targetDate?: string | null | undefined;
  targetDateResolution?: DateResolution | null | undefined;
  labelIds?: string[] | undefined;
}

/**
 * Apply one Initiative change to the aggregate cache without allowing the local navigation
 * identity to diverge from the document it represents.
 *
 * @param current - The aggregate currently cached for the Initiative, if any.
 * @param apply - The Initiative document update to apply.
 * @returns The aligned aggregate, or `undefined` when no aggregate has been cached.
 */
export function patchInitiativeAggregate(
  current: InitiativeDetailAggregate | undefined,
  apply: (initiative: InitiativeDetail) => InitiativeDetail,
): InitiativeDetailAggregate | undefined {
  if (!current) return undefined;
  const initiative = apply(current.defaultView.initiative);
  return {
    ...current,
    references:
      initiative.ownerId === current.defaultView.initiative.ownerId
        ? current.references
        : { ...current.references, owner: null },
    snapshot: {
      ...current.snapshot,
      name: initiative.name,
      status: InitiativeStatusKey.parse(initiative.status),
      priority: initiative.priority,
      health: initiative.health ?? null,
    },
    defaultView: { initiative },
  };
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
    ...(patch.targetDateResolution !== undefined
      ? { targetDateResolution: patch.targetDateResolution }
      : {}),
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
  const detailKey = useMemo(
    () => queryKeys.initiativeAggregate(orgId, initiativeId),
    [orgId, initiativeId],
  );
  const timelineKey = useMemo(() => [...detailKey, 'timeline'] as const, [detailKey]);
  const labelsKey = useMemo(() => [...detailKey, 'labels'] as const, [detailKey]);
  const relationshipKey = useMemo(
    () => [...queryKeys.initiative(orgId, initiativeId), 'relationship-sections'] as const,
    [orgId, initiativeId],
  );
  const overviewKey = useMemo(() => queryKeys.initiatives(orgId), [orgId]);
  const associationKeys = useMemo(
    () => [timelineKey, detailKey, relationshipKey, overviewKey] as const,
    [timelineKey, detailKey, relationshipKey, overviewKey],
  );

  const patchDetail = (
    apply: (initiative: InitiativeDetail) => InitiativeDetail,
  ): InitiativeDetailAggregate | undefined => {
    const previous = queryClient.getQueryData<InitiativeDetailAggregate>(detailKey);
    queryClient.setQueryData<InitiativeDetailAggregate>(detailKey, (current) =>
      patchInitiativeAggregate(current, apply),
    );
    return previous;
  };

  const patch = useApiMutation<
    InitiativeOut,
    InitiativePatch,
    { previous?: InitiativeDetailAggregate | undefined }
  >({
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
      const { labelIds: _labelIds, ...properties } = body;
      const previous = patchDetail((initiative) => Object.assign({}, initiative, properties));
      return { previous };
    },
    onError: (_err, _body, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(detailKey, ctx.previous);
    },
    onSuccess: (updated) => {
      patchDetail((initiative) => ({
        ...initiative,
        ...updated,
        childMix: initiative.childMix,
        distribution: initiative.distribution,
        rolledUpHealth: initiative.rolledUpHealth,
      }));
    },
    // The Resources tab's derived sections are a projection of this record's prose, and the query
    // cache survives a reload — so without this, adding a mention to the description leaves that
    // tab showing the pre-edit answer until the staleness tier happens to expire.
    invalidateKeys: [
      detailKey,
      labelsKey,
      overviewKey,
      queryKeys.entityMentions(orgId, 'initiative', initiativeId),
    ],
  });

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
