'use client';

/**
 * `useProjectDraftPersistence` — keep the project composer's draft on the server.
 *
 * @remarks
 * Binds the project codec to the rosters the composer has loaded, so a reopened draft can only
 * name a team, lead, program, or initiative the destination workspace still offers.
 */
import type { ComposerDraftPayload } from '@docket/work/composer-draft-contract';
import { useMemo } from 'react';

import { composerIsDirty } from '@/components/composer/composer-dirty';
import type { ComposerDraft } from '@/components/composer/use-composer-draft';
import type { ComposerDraftPersistence } from '@/components/composer/use-composer-draft-persistence';
import { useComposerKindPersistence } from '@/components/composer/use-composer-kind-persistence';
import type { ComposerOptions } from '@/components/pickers/use-composer-options';
import type { TeamOut } from '@/lib/contracts/team';

import type { ProjectDraft } from './create-project';
import {
  type ProjectDraftRosters,
  hydrateProjectDraft,
  serializeProjectDraft,
} from './project-draft-codec';

/** What the project composer supplies. */
export interface ProjectDraftPersistenceOptions {
  readonly orgId: string;
  readonly open: boolean;
  readonly destinationReady: boolean;
  readonly draft: ProjectDraft;
  readonly updateDraft: ComposerDraft<ProjectDraft>['updateDraft'];
  readonly resumeDraftId: string | null | undefined;
  readonly onDraftIdChange: ((draftId: string | null) => void) | undefined;
  /** The option rosters the pickers draw from. */
  readonly options: ComposerOptions;
  readonly teams: readonly TeamOut[];
}

/** Persist the project composer's draft. */
export function useProjectDraftPersistence({
  orgId,
  open,
  destinationReady,
  draft,
  updateDraft,
  resumeDraftId,
  onDraftIdChange,
  options,
  teams,
}: ProjectDraftPersistenceOptions): ComposerDraftPersistence {
  const { actorOptions, programOptions, initiativeOptions } = options;
  const rosters = useMemo<ProjectDraftRosters>(
    () => ({
      teams: teams.map((team) => team.id),
      actors: actorOptions.map((option) => option.value),
      programs: programOptions.map((option) => option.value),
      initiatives: initiativeOptions.map((option) => option.value),
    }),
    [actorOptions, initiativeOptions, programOptions, teams],
  );
  const hydrate = useMemo(
    () => (payload: ComposerDraftPayload) => hydrateProjectDraft(payload, rosters),
    [rosters],
  );

  return useComposerKindPersistence<ProjectDraft>({
    kind: 'project',
    orgId,
    open,
    destinationReady,
    draft,
    isDirty: composerIsDirty({
      title: draft.name,
      summary: draft.summary,
      body: draft.description,
    }),
    serialize: serializeProjectDraft,
    hydrate,
    updateDraft,
    resumeDraftId,
    onDraftIdChange,
  });
}
