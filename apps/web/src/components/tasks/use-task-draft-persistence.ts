'use client';

/**
 * `useTaskDraftPersistence` — keep the task composer's draft on the server.
 *
 * @remarks
 * Binds the task codec to the rosters the composer has loaded, so a reopened draft can only name
 * a team, person, project, milestone, cycle, or label the destination workspace still offers. The
 * rosters are hook results whose identity changes as they load, so the `hydrate` handed on is
 * rebuilt only when one of them does.
 */
import type { ComposerDraftPayload } from '@docket/work/composer-draft-contract';
import type { WorkflowState } from '@docket/work/workflow';
import { useMemo } from 'react';

import { composerIsDirty } from '@/components/composer/composer-dirty';
import type { ComposerDraft } from '@/components/composer/use-composer-draft';
import type { ComposerDraftPersistence } from '@/components/composer/use-composer-draft-persistence';
import { useComposerKindPersistence } from '@/components/composer/use-composer-kind-persistence';
import type { ComposerOptions } from '@/components/pickers/use-composer-options';
import type { TeamOut } from '@/lib/contracts/team';

import type { TaskDraft } from './create-task';
import { type TaskDraftRosters, hydrateTaskDraft, serializeTaskDraft } from './task-draft-codec';

/** What the task composer supplies. */
export interface TaskDraftPersistenceOptions {
  readonly orgId: string;
  readonly open: boolean;
  readonly destinationReady: boolean;
  readonly draft: TaskDraft;
  /** Whether the task was already created, after which the text is no longer a draft. */
  readonly committed: boolean;
  readonly updateDraft: ComposerDraft<TaskDraft>['updateDraft'];
  readonly resumeDraftId: string | null | undefined;
  readonly onDraftIdChange: ((draftId: string | null) => void) | undefined;
  /** The option rosters the pickers draw from. */
  readonly options: ComposerOptions;
  readonly teams: readonly TeamOut[];
  readonly defaultTeamId: string | null;
  /** The team whose workflow states are loaded. */
  readonly teamId: string | null;
  readonly workflowStates: readonly WorkflowState[];
}

/** Persist the task composer's draft. */
export function useTaskDraftPersistence({
  orgId,
  open,
  destinationReady,
  draft,
  committed,
  updateDraft,
  resumeDraftId,
  onDraftIdChange,
  options,
  teams,
  defaultTeamId,
  teamId,
  workflowStates,
}: TaskDraftPersistenceOptions): ComposerDraftPersistence {
  const { actorOptions, projectOptions, milestones, cycles, labelOptions } = options;
  const rosters = useMemo<TaskDraftRosters>(
    () => ({
      teams: teams.map((team) => team.id),
      defaultTeamId,
      statesTeamId: teamId,
      states: workflowStates.map((state) => state.key),
      actors: actorOptions.map((option) => option.value),
      projects: projectOptions.map((option) => option.value),
      milestones: milestones.map(({ id, projectId }) => ({ id, projectId })),
      cycles: cycles.map(({ id, teamId: cycleTeamId }) => ({ id, teamId: cycleTeamId })),
      labels: labelOptions.map((option) => option.value),
    }),
    [
      actorOptions,
      cycles,
      defaultTeamId,
      labelOptions,
      milestones,
      projectOptions,
      teamId,
      teams,
      workflowStates,
    ],
  );
  const hydrate = useMemo(
    () => (payload: ComposerDraftPayload) => hydrateTaskDraft(payload, rosters),
    [rosters],
  );

  return useComposerKindPersistence<TaskDraft>({
    kind: 'task',
    orgId,
    open,
    destinationReady,
    draft,
    isDirty: composerIsDirty({
      title: draft.title,
      body: draft.description,
      draftCommitted: committed,
    }),
    serialize: serializeTaskDraft,
    hydrate,
    updateDraft,
    resumeDraftId,
    onDraftIdChange,
  });
}
