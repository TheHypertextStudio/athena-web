/**
 * The initiative composer's draft codec: its {@link InitiativeDraft} to and from the saved payload.
 *
 * @remarks
 * Serialization writes every field. Hydration checks the owner against the actors the composer
 * has loaded and drops an owner the workspace no longer offers. The enum fields are left alone
 * when the payload has none, so the composer's own defaults stand.
 */
import { ActorId } from '@docket/identity-access/ids';
import type { ComposerDraftPayload } from '@docket/work/composer-draft-contract';

import {
  brandId,
  inRoster,
  timeframeFromWire,
  timeframeToWire,
} from '@/components/composer/draft-codec-utils';

import type { InitiativeDraft } from './create-initiative';

/** The rosters an initiative reference is checked against on hydration. */
export interface InitiativeDraftRosters {
  /** Members and agents an initiative may be owned by. */
  readonly actors: readonly string[];
}

/** The initiative composer's draft as the API stores it. */
export function serializeInitiativeDraft(draft: InitiativeDraft): ComposerDraftPayload {
  return {
    kind: 'initiative',
    name: draft.name,
    summary: draft.summary,
    description: draft.description,
    ownerId: brandId(ActorId, draft.ownerId),
    status: draft.status,
    targetTimeframe: timeframeToWire(draft.targetTimeframe),
    health: draft.health,
    priority: draft.priority,
    updateCadence: draft.updateCadence,
  };
}

/**
 * The initiative composer's draft from a saved payload.
 *
 * @param payload - Any composer's saved payload; another kind's yields an empty patch.
 * @param rosters - What the destination workspace currently offers.
 * @returns the fields to pour into the composer.
 */
export function hydrateInitiativeDraft(
  payload: ComposerDraftPayload,
  rosters: InitiativeDraftRosters,
): Partial<InitiativeDraft> {
  if (payload.kind !== 'initiative') return {};
  return {
    name: payload.name ?? '',
    summary: payload.summary ?? '',
    description: payload.description ?? '',
    ownerId: inRoster(payload.ownerId, rosters.actors),
    ...(payload.status === undefined ? {} : { status: payload.status }),
    targetTimeframe: timeframeFromWire(payload.targetTimeframe),
    health: payload.health ?? null,
    ...(payload.priority === undefined ? {} : { priority: payload.priority }),
    ...(payload.updateCadence === undefined ? {} : { updateCadence: payload.updateCadence }),
  };
}
