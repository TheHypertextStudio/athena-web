/**
 * The program composer's draft codec: its {@link ProgramDraft} to and from the saved payload.
 *
 * @remarks
 * Serialization writes every field. Hydration checks the owner against the actors the composer
 * has loaded and drops an owner the workspace no longer offers. The enum fields are left alone
 * when the payload has none, so the composer's own defaults stand.
 */
import { ActorId } from '@docket/identity-access/ids';
import type { ComposerDraftPayload } from '@docket/work/composer-draft-contract';

import { brandId, inRoster } from '@/components/composer/draft-codec-utils';

import type { ProgramDraft } from './create-program';

/** The rosters a program reference is checked against on hydration. */
export interface ProgramDraftRosters {
  /** Members and agents a program may be owned by. */
  readonly actors: readonly string[];
}

/** The program composer's draft as the API stores it. */
export function serializeProgramDraft(draft: ProgramDraft): ComposerDraftPayload {
  return {
    kind: 'program',
    name: draft.name,
    summary: draft.summary,
    description: draft.description,
    ownerId: brandId(ActorId, draft.ownerId),
    status: draft.status,
    health: draft.health,
    visibility: draft.visibility,
  };
}

/**
 * The program composer's draft from a saved payload.
 *
 * @param payload - Any composer's saved payload; another kind's yields an empty patch.
 * @param rosters - What the destination workspace currently offers.
 * @returns the fields to pour into the composer.
 */
export function hydrateProgramDraft(
  payload: ComposerDraftPayload,
  rosters: ProgramDraftRosters,
): Partial<ProgramDraft> {
  if (payload.kind !== 'program') return {};
  return {
    name: payload.name ?? '',
    summary: payload.summary ?? '',
    description: payload.description ?? '',
    ownerId: inRoster(payload.ownerId, rosters.actors),
    ...(payload.status === undefined ? {} : { status: payload.status }),
    health: payload.health ?? null,
    ...(payload.visibility === undefined ? {} : { visibility: payload.visibility }),
  };
}
