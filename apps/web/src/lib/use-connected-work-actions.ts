'use client';

/**
 * The writes behind the Initiative's Connected work panel: create a Project into this Initiative,
 * link or unlink an existing Project or Program, and the candidate rosters those pickers offer.
 *
 * @remarks
 * Kept beside the panel rather than inside the Initiative detail page so the page stays about the
 * document. The link/unlink calls come from {@link useInitiativeMutations}, which has always
 * exposed them; nothing called them until this panel existed.
 */
import type { InitiativeConnectedWork } from '@docket/work/initiative-contract';
import { InitiativeId, ProgramId } from '@docket/work/ids';
import type { PickerOption } from '@docket/ui/components';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { ConnectedWorkActions } from '@/components/initiatives/initiative-connected-work';
import { useCreateObject } from '@/components/create-object/create-object-provider';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { api } from '@/lib/api';
import type { ProjectOut } from '@/lib/contracts/project';
import { unwrap, useApiMutation } from '@/lib/query';
import type { InitiativeMutations } from '@/lib/use-initiative-mutations';
import { invalidateWorkTargetQueries } from '@/lib/work-target-invalidation';

/** The lists the Connected work link pickers draw from. */
const CONNECTED_WORK_INCLUDE = ['projects', 'programs'] as const;

/** What {@link useConnectedWorkActions} needs from its host page. */
export interface ConnectedWorkActionsInput {
  readonly orgId: string;
  readonly initiativeId: string;
  /** Whether the viewer may contribute to this Initiative. */
  readonly canEdit: boolean;
  /** Whether the panel is on screen; false keeps the candidate rosters unread. */
  readonly enabled: boolean;
  /** The Initiative's current connected work, used to keep linked rows out of the pickers. */
  readonly connectedWork: readonly InitiativeConnectedWork[];
  /** The vocabulary-skinned singular Project noun. */
  readonly projectNoun: string;
  /** The Initiative's link/unlink mutations. */
  readonly mutations: InitiativeMutations;
}

/** Collect linked ids by kind before filtering the workspace's candidate rosters. */
function linkedWorkIds(items: readonly InitiativeConnectedWork[]): {
  programs: ReadonlySet<string>;
  projects: ReadonlySet<string>;
} {
  const ids = { programs: new Set<string>(), projects: new Set<string>() };
  for (const item of items) {
    if (item.kind === 'program') ids.programs.add(item.id);
    else ids.projects.add(item.id);
  }
  return ids;
}

/**
 * Bind the Connected work panel's create, link, and unlink actions to one Initiative.
 *
 * @param input - See {@link ConnectedWorkActionsInput}.
 * @returns The actions the panel renders its controls from.
 */
export function useConnectedWorkActions({
  orgId,
  initiativeId,
  canEdit,
  enabled,
  connectedWork,
  projectNoun,
  mutations,
}: ConnectedWorkActionsInput): ConnectedWorkActions {
  const queryClient = useQueryClient();
  const { openCreate } = useCreateObject();
  const options = useComposerOptions(orgId, CONNECTED_WORK_INCLUDE, enabled && canEdit);

  const linkedIds = useMemo(() => linkedWorkIds(connectedWork), [connectedWork]);

  const projectOptions = useMemo<readonly PickerOption[]>(
    () => options.projectOptions.filter((option) => !linkedIds.projects.has(option.value)),
    [options.projectOptions, linkedIds],
  );
  const programOptions = useMemo<readonly PickerOption[]>(
    () => options.programOptions.filter((option) => !linkedIds.programs.has(option.value)),
    [options.programOptions, linkedIds],
  );

  const createProject = useApiMutation<ProjectOut, { name: string; programId: string | null }>({
    mutationFn: ({ name, programId }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].projects.$post({
            param: { orgId },
            json: {
              name,
              initiativeIds: [InitiativeId.parse(initiativeId)],
              ...(programId === null ? {} : { programId: ProgramId.parse(programId) }),
            },
          }),
        `Could not add the ${projectNoun.toLowerCase()}.`,
      ),
    // The Initiative prefix covers this page's relationship-sections read, whose key sits under
    // `['org', orgId, 'initiatives']`; the Project prefix refreshes every roster the new row
    // belongs in, including the pickers above.
    onSettled: () => {
      void invalidateWorkTargetQueries(queryClient, {
        target: 'initiative',
        ownerOrganizationId: orgId,
      });
      void invalidateWorkTargetQueries(queryClient, {
        target: 'project',
        ownerOrganizationId: orgId,
      });
    },
  });

  return {
    canEdit,
    busy: mutations.programBusy || mutations.projectBusy,
    projectOptions,
    projectProgramIds: new Map(
      options.projects.map((project) => [project.id, project.programId ?? null]),
    ),
    programOptions,
    optionsLoading: options.loading,
    onLinkProject: mutations.linkProject,
    onLinkProgram: mutations.linkProgram,
    onUnlink: (kind, id) => {
      if (kind === 'program') mutations.unlinkProgram(id);
      else mutations.unlinkProject(id);
    },
    onCreateProject: (programId) => {
      openCreate({
        kind: 'project',
        initialWorkspaceId: orgId,
        defaultInitiativeIds: [initiativeId],
        ...(programId === null ? {} : { defaultProgramId: programId }),
        // Stay put: the point of creating from here is to keep scoping the Initiative out.
        sameWorkspaceCompletion: 'stay',
      });
    },
    onQuickAddProject: async (name, programId) => {
      await createProject.mutateAsync({ name, programId });
    },
  };
}
