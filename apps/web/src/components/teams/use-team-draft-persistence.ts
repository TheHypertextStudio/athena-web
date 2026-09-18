'use client';

/**
 * `useTeamDraftPersistence` — keep the team composer's draft on the server.
 *
 * @remarks
 * A team draft names no other record, so its codec needs no rosters and its `hydrate` is the
 * module-level codec function itself.
 */
import { composerIsDirty } from '@/components/composer/composer-dirty';
import type { ComposerDraft } from '@/components/composer/use-composer-draft';
import type { ComposerDraftPersistence } from '@/components/composer/use-composer-draft-persistence';
import { useComposerKindPersistence } from '@/components/composer/use-composer-kind-persistence';

import type { TeamDraft } from './create-team';
import { hydrateTeamDraft, serializeTeamDraft } from './team-draft-codec';

/** What the team composer supplies. */
export interface TeamDraftPersistenceOptions {
  readonly orgId: string;
  readonly open: boolean;
  readonly destinationReady: boolean;
  readonly draft: TeamDraft;
  readonly updateDraft: ComposerDraft<TeamDraft>['updateDraft'];
  readonly resumeDraftId: string | null | undefined;
  readonly onDraftIdChange: ((draftId: string | null) => void) | undefined;
}

/** Persist the team composer's draft. */
export function useTeamDraftPersistence({
  orgId,
  open,
  destinationReady,
  draft,
  updateDraft,
  resumeDraftId,
  onDraftIdChange,
}: TeamDraftPersistenceOptions): ComposerDraftPersistence {
  return useComposerKindPersistence<TeamDraft>({
    kind: 'team',
    orgId,
    open,
    destinationReady,
    draft,
    isDirty: composerIsDirty({
      title: draft.name,
      summary: draft.summary,
      body: draft.description,
    }),
    serialize: serializeTeamDraft,
    hydrate: hydrateTeamDraft,
    updateDraft,
    resumeDraftId,
    onDraftIdChange,
  });
}
