'use client';

/**
 * `useInitiativeDraftPersistence` — keep the initiative composer's draft on the server.
 *
 * @remarks
 * Binds the initiative codec to the actors the composer has loaded, so a reopened draft can only
 * name an owner the destination workspace still offers.
 */
import type { ComposerDraftPayload } from '@docket/work/composer-draft-contract';
import { useMemo } from 'react';

import { composerIsDirty } from '@/components/composer/composer-dirty';
import type { ComposerDraft } from '@/components/composer/use-composer-draft';
import type { ComposerDraftPersistence } from '@/components/composer/use-composer-draft-persistence';
import { useComposerKindPersistence } from '@/components/composer/use-composer-kind-persistence';
import type { ComposerOptions } from '@/components/pickers/use-composer-options';

import type { InitiativeDraft } from './create-initiative';
import {
  type InitiativeDraftRosters,
  hydrateInitiativeDraft,
  serializeInitiativeDraft,
} from './initiative-draft-codec';

/** What the initiative composer supplies. */
export interface InitiativeDraftPersistenceOptions {
  readonly orgId: string;
  readonly open: boolean;
  readonly destinationReady: boolean;
  readonly draft: InitiativeDraft;
  readonly updateDraft: ComposerDraft<InitiativeDraft>['updateDraft'];
  readonly resumeDraftId: string | null | undefined;
  readonly onDraftIdChange: ((draftId: string | null) => void) | undefined;
  /** The option rosters the pickers draw from. */
  readonly options: ComposerOptions;
}

/** Persist the initiative composer's draft. */
export function useInitiativeDraftPersistence({
  orgId,
  open,
  destinationReady,
  draft,
  updateDraft,
  resumeDraftId,
  onDraftIdChange,
  options,
}: InitiativeDraftPersistenceOptions): ComposerDraftPersistence {
  const { actorOptions } = options;
  const rosters = useMemo<InitiativeDraftRosters>(
    () => ({ actors: actorOptions.map((option) => option.value) }),
    [actorOptions],
  );
  const hydrate = useMemo(
    () => (payload: ComposerDraftPayload) => hydrateInitiativeDraft(payload, rosters),
    [rosters],
  );

  return useComposerKindPersistence<InitiativeDraft>({
    kind: 'initiative',
    orgId,
    open,
    destinationReady,
    draft,
    isDirty: composerIsDirty({
      title: draft.name,
      summary: draft.summary,
      body: draft.description,
    }),
    serialize: serializeInitiativeDraft,
    hydrate,
    updateDraft,
    resumeDraftId,
    onDraftIdChange,
  });
}
