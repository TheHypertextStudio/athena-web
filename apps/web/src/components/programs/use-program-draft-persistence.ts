'use client';

/**
 * `useProgramDraftPersistence` — keep the program composer's draft on the server.
 *
 * @remarks
 * Binds the program codec to the actors the composer has loaded, so a reopened draft can only
 * name an owner the destination workspace still offers.
 */
import type { ComposerDraftPayload } from '@docket/work/composer-draft-contract';
import { useMemo } from 'react';

import { composerIsDirty } from '@/components/composer/composer-dirty';
import type { ComposerDraft } from '@/components/composer/use-composer-draft';
import type { ComposerDraftPersistence } from '@/components/composer/use-composer-draft-persistence';
import { useComposerKindPersistence } from '@/components/composer/use-composer-kind-persistence';
import type { ComposerOptions } from '@/components/pickers/use-composer-options';

import type { ProgramDraft } from './create-program';
import {
  type ProgramDraftRosters,
  hydrateProgramDraft,
  serializeProgramDraft,
} from './program-draft-codec';

/** What the program composer supplies. */
export interface ProgramDraftPersistenceOptions {
  readonly orgId: string;
  readonly open: boolean;
  readonly destinationReady: boolean;
  readonly draft: ProgramDraft;
  readonly updateDraft: ComposerDraft<ProgramDraft>['updateDraft'];
  readonly resumeDraftId: string | null | undefined;
  readonly onDraftIdChange: ((draftId: string | null) => void) | undefined;
  /** The option rosters the pickers draw from. */
  readonly options: ComposerOptions;
}

/** Persist the program composer's draft. */
export function useProgramDraftPersistence({
  orgId,
  open,
  destinationReady,
  draft,
  updateDraft,
  resumeDraftId,
  onDraftIdChange,
  options,
}: ProgramDraftPersistenceOptions): ComposerDraftPersistence {
  const { actorOptions } = options;
  const rosters = useMemo<ProgramDraftRosters>(
    () => ({ actors: actorOptions.map((option) => option.value) }),
    [actorOptions],
  );
  const hydrate = useMemo(
    () => (payload: ComposerDraftPayload) => hydrateProgramDraft(payload, rosters),
    [rosters],
  );

  return useComposerKindPersistence<ProgramDraft>({
    kind: 'program',
    orgId,
    open,
    destinationReady,
    draft,
    isDirty: composerIsDirty({
      title: draft.name,
      summary: draft.summary,
      body: draft.description,
    }),
    serialize: serializeProgramDraft,
    hydrate,
    updateDraft,
    resumeDraftId,
    onDraftIdChange,
  });
}
