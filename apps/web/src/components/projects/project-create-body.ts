import { serializeWorkTemplateSelection } from '@/components/composer/work-template-draft';
import type { WorkTemplateDraftFields } from '@/components/composer/work-template-draft';
/**
 * The project composer's draft value and the pure functions that turn it into a create body.
 *
 * @remarks
 * Separated from the composer component so the request shape can be read and tested without the
 * dialog around it — every optional field is omitted rather than sent empty, which is a
 * conditional spread each.
 */
import { ActorId, TeamId } from '@docket/identity-access/ids';
import { type Health } from '@docket/work/capability-contract';
import { InitiativeId, ProgramId } from '@docket/work/ids';
import type { MilestoneCreate } from '@docket/work/milestone-contract';
import type { PlanningTimeframe } from '@docket/work/planning-timeframe';

import type { DraftMilestone } from '@/components/projects/project-milestones-field';
import { type ProjectCreate, type ProjectStatus } from '@/lib/contracts/project';

/** Every field the project composer holds, as one value. */
export interface ProjectDraft extends WorkTemplateDraftFields {
  name: string;
  summary: string;
  description: string;
  /** The team chosen in the picker, or null to follow the org default. */
  teamOverride: string | null;
  leadId: string | null;
  programId: string | null;
  status: ProjectStatus;
  health: Health | null;
  startTimeframe: PlanningTimeframe | null;
  targetTimeframe: PlanningTimeframe | null;
  initiativeIds: readonly string[];
  /**
   * Checkpoints to create alongside the Project, in the order they will be created.
   *
   * @remarks
   * Drafts until the Project exists: they have no id and nothing is persisted until submit, which
   * sends them in the create body. Their position in this list becomes their `sort`.
   */
  milestones: readonly DraftMilestone[];
}

/** Clear destination-owned references while retaining portable authored dates. */
export function projectWorkspaceReset(
  startTimeframe: PlanningTimeframe | null,
  targetTimeframe: PlanningTimeframe | null,
): Partial<ProjectDraft> {
  return {
    workTypeId: null,
    workTypeVersionId: null,
    teamOverride: null,
    leadId: null,
    programId: null,
    initiativeIds: [],
    startTimeframe: startTimeframe?.resolution ? null : startTimeframe,
    targetTimeframe: targetTimeframe?.resolution ? null : targetTimeframe,
  };
}

/**
 * The drafted checkpoints as create entries, in display order.
 *
 * @remarks
 * A row emptied after it was added is dropped rather than sent: the name is the whole of a
 * milestone and the contract requires one. Position is left out — the server reads the array order
 * as the `sort`, so there is nothing to number here.
 *
 * @param drafts - The composer's milestone rows.
 * @returns the entries for the create body's `milestones`.
 */
export function draftMilestoneBodies(drafts: readonly DraftMilestone[]): MilestoneCreate[] {
  return drafts.flatMap((draft) => {
    const name = draft.name.trim();
    if (name.length === 0) return [];
    const note = draft.description.trim();
    return [
      {
        name,
        ...(note.length > 0 ? { description: note } : {}),
        ...(draft.targetDate === null ? {} : { targetDate: draft.targetDate }),
      },
    ];
  });
}

/**
 * Build the Project create body from the draft.
 *
 * @remarks
 * Every optional field is omitted rather than sent empty, which is a conditional spread each — so
 * this lives outside `submit` and keeps that function about the write itself.
 *
 * @param draft - The composer's current values.
 * @param name - The trimmed project name.
 * @param teamId - The resolved destination team, or `null` to follow the org default.
 * @returns the request body.
 */
export function projectCreateBody(draft: ProjectDraft, name: string, teamId: string | null) {
  const summary = draft.summary.trim();
  const description = draft.description.trim();
  const milestones = draftMilestoneBodies(draft.milestones);
  return {
    ...serializeWorkTemplateSelection(draft),
    name,
    ...(summary.length > 0 || draft.workTypeId ? { summary } : {}),
    ...(description.length > 0 || draft.workTypeId ? { description } : {}),
    ...(teamId ? { teamId: TeamId.parse(teamId) } : {}),
    ...(draft.leadId ? { leadId: ActorId.parse(draft.leadId) } : {}),
    ...(draft.programId ? { programId: ProgramId.parse(draft.programId) } : {}),
    status: draft.status,
    ...(draft.health || draft.workTypeId ? { health: draft.health } : {}),
    ...projectPlanningFields(draft),
    // Written in the Project's own transaction, so there is no window where the Project exists and
    // its checkpoints do not — and nothing for this composer to recover from.
    ...(milestones.length > 0 ? { milestones } : {}),
  };
}

/**
 * The Initiatives a contextual request seeds into a fresh draft.
 *
 * @remarks
 * Contextual defaults belong to the workspace the composer opened in. Retargeting it to another
 * workspace makes an Initiative id from the first one unusable, so the seed drops rather than
 * travelling — the same rule {@link CreateProjectDialogProps.defaultProgramId} follows.
 *
 * @param applies - Whether the composer still targets its opening workspace.
 * @param defaults - The requested Initiative ids, if any.
 * @returns the draft's opening `initiativeIds`.
 */
export function seededInitiativeIds(
  applies: boolean,
  defaults: readonly string[] | null | undefined,
): readonly string[] {
  if (!applies) return [];
  return defaults ?? [];
}

/** Keep the Project's authored planning windows and Initiative links in its create request. */
function projectPlanningFields(
  draft: ProjectDraft,
): Pick<
  ProjectCreate,
  'startDate' | 'startDateResolution' | 'targetDate' | 'targetDateResolution' | 'initiativeIds'
> {
  return {
    ...(draft.startTimeframe
      ? {
          startDate: draft.startTimeframe.date,
          startDateResolution: draft.startTimeframe.resolution,
        }
      : {}),
    ...(draft.targetTimeframe
      ? {
          targetDate: draft.targetTimeframe.date,
          targetDateResolution: draft.targetTimeframe.resolution,
        }
      : {}),
    ...(draft.initiativeIds.length > 0
      ? { initiativeIds: draft.initiativeIds.map((id) => InitiativeId.parse(id)) }
      : {}),
  };
}
