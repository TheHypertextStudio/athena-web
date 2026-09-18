/**
 * The task composer's draft codec: its {@link TaskDraft} to and from the saved payload.
 *
 * @remarks
 * Serialization is total: every field is written, so a saved draft is the whole composer.
 * Hydration is defensive: every reference is checked against the roster the composer has loaded
 * (see {@link TaskDraftRosters}) and anything the workspace no longer offers becomes "not set". A
 * milestone must still belong to the drafted project and a cycle to the drafted team, the same
 * rules the pickers apply while typing. The workflow state is kept only when the drafted team is
 * the team whose states are loaded; otherwise the composer's own team effect fills in the new
 * team's first state.
 */
import { ActorId, TeamId } from '@docket/identity-access/ids';
import type {
  ComposerDraftPayload,
  ComposerRepeatDraft,
  TaskDraftPayload,
} from '@docket/work/composer-draft-contract';
import { CycleId, LabelId, MilestoneId, ProjectId } from '@docket/work/ids';

import { allInRoster, brandId, brandIds, inRoster } from '@/components/composer/draft-codec-utils';
import type { TaskRepeatDraft } from '@/components/recurrence/repeat-task-control';
import { AfterCompletionSchedule, CalendarRecurrenceSchedule } from '@/lib/contracts/recurrence';

import type { TaskDraft } from './create-task';

/** A milestone the composer may offer, with the project it belongs to. */
export interface ProjectMilestoneRef {
  readonly id: string;
  readonly projectId: string;
}

/** A cycle the composer may offer, with the team whose cadence it follows. */
export interface TeamCycleRef {
  readonly id: string;
  readonly teamId: string;
}

/** The rosters a task reference is checked against on hydration. */
export interface TaskDraftRosters {
  /** The teams a task may be created in. */
  readonly teams: readonly string[];
  /** The team a task follows when the draft names none. */
  readonly defaultTeamId: string | null;
  /** The team whose workflow states are loaded. */
  readonly statesTeamId: string | null;
  /** That team's workflow state keys. */
  readonly states: readonly string[];
  /** Members and agents a task may be assigned to. */
  readonly actors: readonly string[];
  readonly projects: readonly string[];
  readonly milestones: readonly ProjectMilestoneRef[];
  readonly cycles: readonly TeamCycleRef[];
  readonly labels: readonly string[];
}

/** The task composer's draft as the API stores it. */
export function serializeTaskDraft(draft: TaskDraft): ComposerDraftPayload {
  return {
    kind: 'task',
    title: draft.title,
    description: draft.description,
    teamOverride: brandId(TeamId, draft.teamOverride),
    state: draft.state,
    priority: draft.priority,
    assigneeId: brandId(ActorId, draft.assigneeId),
    projectId: brandId(ProjectId, draft.projectId),
    milestoneId: brandId(MilestoneId, draft.milestoneId),
    cycleId: brandId(CycleId, draft.cycleId),
    startDate: draft.startDate,
    dueDate: draft.dueDate,
    labelIds: brandIds(LabelId, draft.labelIds),
    estimate: draft.estimate,
    repeat: draft.repeat,
  };
}

/** The repeat value as the composer holds it, or "once" when the saved schedule no longer parses. */
function repeatFromWire(repeat: ComposerRepeatDraft | undefined): TaskRepeatDraft {
  if (repeat === undefined || repeat.kind === 'none') return { kind: 'none' };
  if (repeat.kind === 'calendar') {
    const schedule = CalendarRecurrenceSchedule.safeParse(repeat.schedule);
    if (!schedule.success) return { kind: 'none' };
    return {
      kind: 'calendar',
      schedule: schedule.data,
      missedPolicy: repeat.missedPolicy,
      materialization: repeat.materialization,
    };
  }
  const schedule = AfterCompletionSchedule.safeParse(repeat.schedule);
  return schedule.success
    ? { kind: 'after_completion', schedule: schedule.data }
    : { kind: 'none' };
}

/** The milestone kept only when it belongs to the drafted project. */
function milestoneFor(
  payload: TaskDraftPayload,
  projectId: string | null,
  rosters: TaskDraftRosters,
): string | null {
  const scoped = rosters.milestones.filter((ref) => ref.projectId === projectId).map((r) => r.id);
  return inRoster(payload.milestoneId, scoped);
}

/** The cycle kept only when it follows the drafted team's cadence. */
function cycleFor(
  payload: TaskDraftPayload,
  teamId: string | null,
  rosters: TaskDraftRosters,
): string | null {
  const scoped = rosters.cycles.filter((ref) => ref.teamId === teamId).map((ref) => ref.id);
  return inRoster(payload.cycleId, scoped);
}

/** The team-bound fields: the team itself, its workflow state, and its cycle. */
function hydrateTeamFields(
  payload: TaskDraftPayload,
  rosters: TaskDraftRosters,
): Partial<TaskDraft> {
  const teamOverride = inRoster(payload.teamOverride, rosters.teams);
  const teamId = teamOverride ?? rosters.defaultTeamId;
  const stateKnown = teamId === rosters.statesTeamId;
  return {
    teamOverride,
    state: stateKnown ? inRoster(payload.state, rosters.states) : null,
    cycleId: cycleFor(payload, teamId, rosters),
  };
}

/** The project-bound fields: the project and the milestone under it. */
function hydrateProjectFields(
  payload: TaskDraftPayload,
  rosters: TaskDraftRosters,
): Partial<TaskDraft> {
  const projectId = inRoster(payload.projectId, rosters.projects);
  return { projectId, milestoneId: milestoneFor(payload, projectId, rosters) };
}

/**
 * The task composer's draft from a saved payload.
 *
 * @param payload - Any composer's saved payload; another kind's yields an empty patch.
 * @param rosters - What the destination workspace currently offers.
 * @returns the fields to pour into the composer.
 */
export function hydrateTaskDraft(
  payload: ComposerDraftPayload,
  rosters: TaskDraftRosters,
): Partial<TaskDraft> {
  if (payload.kind !== 'task') return {};
  return {
    title: payload.title ?? '',
    description: payload.description ?? '',
    priority: payload.priority ?? 'none',
    assigneeId: inRoster(payload.assigneeId, rosters.actors),
    startDate: payload.startDate ?? null,
    dueDate: payload.dueDate ?? null,
    labelIds: allInRoster(payload.labelIds, rosters.labels),
    estimate: payload.estimate ?? null,
    repeat: repeatFromWire(payload.repeat),
    ...hydrateTeamFields(payload, rosters),
    ...hydrateProjectFields(payload, rosters),
  };
}
