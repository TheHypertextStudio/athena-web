/**
 * The project composer's draft codec: its {@link ProjectDraft} to and from the saved payload.
 *
 * @remarks
 * Serialization writes every field. Hydration checks the team, lead, program, and initiatives
 * against the rosters the composer has loaded and drops what the workspace no longer offers.
 * Milestone rows come back with fresh keys: a key is local React identity for the row's inputs,
 * not part of the milestone, so it is never saved.
 */
import { ActorId, TeamId } from '@docket/identity-access/ids';
import type { ComposerDraftPayload } from '@docket/work/composer-draft-contract';
import { InitiativeId, ProgramId } from '@docket/work/ids';

import {
  allInRoster,
  brandId,
  brandIds,
  inRoster,
  timeframeFromWire,
  timeframeToWire,
} from '@/components/composer/draft-codec-utils';

import type { ProjectDraft } from './create-project';
import { newDraftMilestoneKey } from './project-milestones-field';

/** The rosters a project reference is checked against on hydration. */
export interface ProjectDraftRosters {
  readonly teams: readonly string[];
  /** Members and agents a project may be led by. */
  readonly actors: readonly string[];
  readonly programs: readonly string[];
  readonly initiatives: readonly string[];
}

/** The project composer's draft as the API stores it. */
export function serializeProjectDraft(draft: ProjectDraft): ComposerDraftPayload {
  return {
    kind: 'project',
    name: draft.name,
    summary: draft.summary,
    description: draft.description,
    teamOverride: brandId(TeamId, draft.teamOverride),
    leadId: brandId(ActorId, draft.leadId),
    programId: brandId(ProgramId, draft.programId),
    status: draft.status,
    health: draft.health,
    startTimeframe: timeframeToWire(draft.startTimeframe),
    targetTimeframe: timeframeToWire(draft.targetTimeframe),
    initiativeIds: brandIds(InitiativeId, draft.initiativeIds),
    milestones: draft.milestones.map(({ name, targetDate, description }) => ({
      name,
      targetDate,
      description,
    })),
  };
}

/**
 * The project composer's draft from a saved payload.
 *
 * @param payload - Any composer's saved payload; another kind's yields an empty patch.
 * @param rosters - What the destination workspace currently offers.
 * @returns the fields to pour into the composer. The status is left alone when the payload has
 * none, so the workspace's starting status stands.
 */
export function hydrateProjectDraft(
  payload: ComposerDraftPayload,
  rosters: ProjectDraftRosters,
): Partial<ProjectDraft> {
  if (payload.kind !== 'project') return {};
  return {
    name: payload.name ?? '',
    summary: payload.summary ?? '',
    description: payload.description ?? '',
    teamOverride: inRoster(payload.teamOverride, rosters.teams),
    leadId: inRoster(payload.leadId, rosters.actors),
    programId: inRoster(payload.programId, rosters.programs),
    ...(payload.status === undefined ? {} : { status: payload.status }),
    health: payload.health ?? null,
    startTimeframe: timeframeFromWire(payload.startTimeframe),
    targetTimeframe: timeframeFromWire(payload.targetTimeframe),
    initiativeIds: allInRoster(payload.initiativeIds, rosters.initiatives),
    milestones: (payload.milestones ?? []).map((row) => ({ key: newDraftMilestoneKey(), ...row })),
  };
}
