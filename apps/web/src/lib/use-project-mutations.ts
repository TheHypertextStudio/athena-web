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
  InitiativeId,
  type ProjectInitiativeReference,
  type ProjectDetailAggregate,
  LabelId,
  type ProjectOut,
  type ProjectStatus,
  type ProjectUpdate,
  ProgramId,
  ProjectStatusKey,
  ProjectSubjectRef,
} from '@docket/types';
import type { DateResolution } from '@docket/work/planning-timeframe';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { api } from './api';
import type { ProjectDetailData } from './fetch-project-detail';
import { userErrorMessage } from './problem';
import { queryKeys, unwrap, useApiMutation } from './query';

/** The unbranded properties-panel patch surface. */
export interface ProjectPatch {
  /** New name. Non-empty; the name cannot be cleared. */
  name?: string | undefined;
  summary?: string | null | undefined;
  description?: string | null | undefined;
  health?: Health | null | undefined;
  leadId?: string | null | undefined;
  status?: ProjectStatus | undefined;
  startDate?: string | null | undefined;
  startDateResolution?: DateResolution | null | undefined;
  targetDate?: string | null | undefined;
  targetDateResolution?: DateResolution | null | undefined;
  programId?: string | null | undefined;
  labelIds?: readonly string[] | undefined;
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
    ...(patch.startDateResolution !== undefined
      ? { startDateResolution: patch.startDateResolution }
      : {}),
    ...(patch.targetDate !== undefined ? { targetDate: patch.targetDate } : {}),
    ...(patch.targetDateResolution !== undefined
      ? { targetDateResolution: patch.targetDateResolution }
      : {}),
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
  setInitiatives: (
    initiativeIds: readonly string[],
    options?: readonly { value: string; label: string }[],
  ) => void;
  /** Post an update; the promise settles with the write so the composer can clear only on success. */
  postUpdate: (body: string) => Promise<void>;
  propsPending: boolean;
  propsError: string | null;
  updatePosting: boolean;
  updateError: string | null;
}

/**
 * Apply one Project edit to the aggregate cache without separating the visible snapshot from the
 * document it represents.
 *
 * @param current - The cached Project aggregate, if one has completed.
 * @param apply - The edit to apply to the Project document.
 * @returns The aligned aggregate, or `undefined` when the route has no cached aggregate yet.
 */
export function patchProjectAggregate(
  current: ProjectDetailAggregate | undefined,
  apply: (project: ProjectOut) => ProjectOut,
): ProjectDetailAggregate | undefined {
  if (!current) return undefined;
  const project = apply(current.defaultView.project);
  return {
    ...current,
    snapshot: {
      ...current.snapshot,
      name: project.name,
      status: ProjectStatusKey.parse(project.status),
      priority: project.priority,
      health: project.health ?? null,
    },
    references: {
      ...current.references,
      lead: project.leadId === current.references.lead?.actorId ? current.references.lead : null,
    },
    defaultView: { ...current.defaultView, project },
  };
}

/**
 * All write operations for the project detail page.
 *
 * @param orgId - The active organization id.
 * @param projectId - The project being mutated.
 */
export function useProjectMutations(
  orgId: string,
  projectId: string,
  aggregateKey: ReturnType<typeof queryKeys.projectAggregate> = queryKeys.projectAggregate(
    orgId,
    projectId,
  ),
  updatesKey = [...aggregateKey, 'updates'] as const,
): ProjectMutations {
  const queryClient = useQueryClient();
  const subject = ProjectSubjectRef.parse({ subjectType: 'project', subjectId: projectId });
  const detailKey = useMemo(() => queryKeys.project(orgId, projectId), [orgId, projectId]);

  const patchCachedProject = useCallback(
    (
      apply: (p: ProjectOut) => ProjectOut,
    ): {
      aggregate?: ProjectDetailAggregate | undefined;
      legacy?: ProjectDetailData | undefined;
    } => {
      const previous = queryClient.getQueryData<ProjectDetailAggregate>(aggregateKey);
      queryClient.setQueryData<ProjectDetailAggregate>(aggregateKey, (cur) =>
        patchProjectAggregate(cur, apply),
      );
      const legacy = queryClient.getQueryData<ProjectDetailData>(detailKey);
      queryClient.setQueryData<ProjectDetailData>(detailKey, (cur) =>
        cur && cur.project ? { ...cur, project: apply(cur.project) } : cur,
      );
      return { aggregate: previous, legacy };
    },
    [queryClient, aggregateKey],
  );

  const patch = useApiMutation<
    ProjectOut,
    ProjectPatch,
    {
      previous?: {
        aggregate?: ProjectDetailAggregate | undefined;
        legacy?: ProjectDetailData | undefined;
      };
    }
  >({
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
      await queryClient.cancelQueries({ queryKey: aggregateKey });
      const body = toProjectPatchBody(patchBody);
      const previous = patchCachedProject((cur) => Object.assign({}, cur, body));
      if (patchBody.labelIds !== undefined) {
        const selected = new Set(patchBody.labelIds);
        // Labels are a picker-owned section rather than aggregate content. Its own query refetches
        // after the write; the aggregate remains truthful without manufacturing label records.
        void selected;
      }
      return { previous };
    },
    onError: (_err, _body, ctx) => {
      if (ctx?.previous?.aggregate) queryClient.setQueryData(aggregateKey, ctx.previous.aggregate);
      if (ctx?.previous?.legacy) queryClient.setQueryData(detailKey, ctx.previous.legacy);
    },
    onSuccess: (updated) => {
      patchCachedProject(() => updated);
    },
    // The Resources tab's derived sections are a projection of this record's prose, and the query
    // cache survives a reload — so without this, adding a mention to the description leaves that
    // tab showing the pre-edit answer until the staleness tier happens to expire.
    invalidateKeys: [
      aggregateKey,
      queryKeys.projects(orgId),
      queryKeys.entityMentions(orgId, 'project', projectId),
    ],
  });

  const initiativeM = useApiMutation<
    ProjectOut,
    {
      initiativeIds: readonly string[];
      options: readonly { value: string; label: string }[];
    },
    {
      previous?: {
        aggregate?: ProjectDetailAggregate | undefined;
        legacy?: ProjectDetailData | undefined;
      };
    }
  >({
    mutationFn: ({ initiativeIds }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].projects[':id'].$patch({
            param: { orgId, id: projectId },
            json: {
              initiativeIds: initiativeIds.map((initiativeId) => InitiativeId.parse(initiativeId)),
            },
          }),
        'Could not update linked Initiatives.',
      ),
    onMutate: async ({ initiativeIds, options }) => {
      await queryClient.cancelQueries({ queryKey: aggregateKey });
      const aggregatePrevious = queryClient.getQueryData<ProjectDetailAggregate>(aggregateKey);
      const legacyPrevious = queryClient.getQueryData<ProjectDetailData>(detailKey);
      queryClient.setQueryData<ProjectDetailAggregate>(aggregateKey, (current) => {
        if (!current) return current;
        const names = new Map<string, ProjectInitiativeReference>(
          current.references.initiatives.map((initiative) => [initiative.id, initiative]),
        );
        for (const option of options) {
          const id = InitiativeId.parse(option.value);
          names.set(id, { id, name: option.label });
        }
        const selected = initiativeIds
          .map((initiativeId) => names.get(initiativeId))
          .flatMap((initiative) => (initiative ? [initiative] : []))
          .sort((left, right) => left.name.localeCompare(right.name));
        return {
          ...current,
          references: {
            ...current.references,
            initiatives: selected,
          },
        };
      });
      queryClient.setQueryData<ProjectDetailData>(detailKey, (current) =>
        current ? { ...current, initiativeIds: [...initiativeIds].sort() } : current,
      );
      const previous = { aggregate: aggregatePrevious, legacy: legacyPrevious };
      return { previous };
    },
    onError: (_err, _next, ctx) => {
      if (ctx?.previous?.aggregate) queryClient.setQueryData(aggregateKey, ctx.previous.aggregate);
      if (ctx?.previous?.legacy) queryClient.setQueryData(detailKey, ctx.previous.legacy);
    },
    onSuccess: (updated) => {
      patchCachedProject(() => updated);
    },
    invalidateKeys: [aggregateKey, [...aggregateKey, 'relationships']],
  });

  const updateM = useApiMutation({
    mutationFn: (body: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].updates.$post({
            param: { orgId },
            json: { ...subject, body },
          }),
        'Could not post your update.',
      ),
    invalidateKeys: [updatesKey, aggregateKey],
  });

  return {
    patchProject: patch.mutate,
    setInitiatives: (initiativeIds, options = []) => {
      initiativeM.mutate({ initiativeIds, options });
    },
    postUpdate: async (body) => {
      await updateM.mutateAsync(body);
    },
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
