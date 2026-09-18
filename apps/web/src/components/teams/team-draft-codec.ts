/**
 * The team composer's draft codec: its {@link TeamDraft} to and from the saved payload, plus the
 * key-derivation rule the composer and the codec share.
 *
 * @remarks
 * A team holds no references to other records, so hydration has no roster to check. What it does
 * restore is the composer's own rule for the key: while the key still matches what the name would
 * suggest, typing the name keeps deriving it; once it differs, the person took the key over and
 * the name leaves it alone. That flag is never saved, because the saved name and key say it.
 */
import type { ComposerDraftPayload } from '@docket/work/composer-draft-contract';

import type { TeamDraft } from './create-team';

/** The longest auto-suggested key length (matches typical Linear-style team prefixes). */
const MAX_SUGGESTED_KEY = 5;

/** Derive a tidy key suggestion from a team name: uppercase alphanumerics, capped in length. */
export function suggestTeamKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, MAX_SUGGESTED_KEY);
}

/** The patch for a typed name, keeping the key in sync until the person has taken it over. */
export function teamNamePatch(current: TeamDraft, name: string): Partial<TeamDraft> {
  return current.keyDirty ? { name } : { name, key: suggestTeamKey(name) };
}

/** The team composer's draft as the API stores it. */
export function serializeTeamDraft(draft: TeamDraft): ComposerDraftPayload {
  return {
    kind: 'team',
    name: draft.name,
    key: draft.key,
    summary: draft.summary,
    description: draft.description,
    triageEnabled: draft.triageEnabled,
    agentGuidance: draft.agentGuidance,
  };
}

/**
 * The team composer's draft from a saved payload.
 *
 * @param payload - Any composer's saved payload; another kind's yields an empty patch.
 * @returns the fields to pour into the composer.
 */
export function hydrateTeamDraft(payload: ComposerDraftPayload): Partial<TeamDraft> {
  if (payload.kind !== 'team') return {};
  const name = payload.name ?? '';
  const key = payload.key ?? '';
  return {
    name,
    key,
    keyDirty: key !== suggestTeamKey(name),
    summary: payload.summary ?? '',
    description: payload.description ?? '',
    triageEnabled: payload.triageEnabled ?? true,
    agentGuidance: payload.agentGuidance ?? '',
  };
}
