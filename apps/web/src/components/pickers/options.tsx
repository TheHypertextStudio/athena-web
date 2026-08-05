/**
 * Pure option-sourcing mappers that feed the `@docket/ui` compact property pickers.
 *
 * @remarks
 * The picker shells in `@docket/ui` are intentionally *presentational*: each takes a plain,
 * pre-resolved array of {@link PickerOption}s and reports a chosen value through `onChange`. The
 * app owns the data, so these helpers translate the org's DTOs — members, agents, projects,
 * programs, initiatives, cycles, teams, labels — and the bounded enums (priority, health, the
 * lifecycle statuses, visibility) into option arrays. Keeping them pure (no React, no RPC) means
 * they are trivially unit-testable and reused by BOTH the detail property panels and the create
 * composers — this is the single module either lane imports from, so a picker's icon, ordering,
 * or copy can't drift depending on which screen renders it.
 *
 * Icons are returned as React nodes (an {@link ActorAvatar}, a {@link PriorityGlyph}, a
 * {@link StatusIcon}, a health/label/visibility swatch) so the picker rows read at a glance; that
 * is why this module is a `.tsx`-adjacent `.ts` exception — it emits JSX and therefore lives as
 * `.tsx`.
 *
 * @see {@link useComposerOptions} for the hook that fetches the data these map over.
 */
import type {
  AgentOut,
  CycleOut,
  CycleStatus,
  Health,
  InitiativeOut,
  InitiativeStatus,
  LabelOut,
  MemberOut,
  Priority,
  ProgramOut,
  ProgramStatus,
  ProjectOut,
  ProjectStatus,
  Visibility,
  WorkflowState,
} from '@docket/types';
import { ActorAvatar, type PickerOption, StatusIcon } from '@docket/ui/components';
import { Globe, Shield } from '@docket/ui/icons';

import { statusGlyphType as cycleStatusGlyphType } from '@/components/cycles/cycle-status';
import { statusGlyphType as programStatusGlyphType } from '@/components/programs/program-status';
import { HEALTH_DOT_CLASS, HEALTH_LABEL } from '@/components/project-detail/health';
import { statusGlyphType as projectStatusGlyphType } from '@/components/projects/project-status';
import { PRIORITY_LABEL, PRIORITY_ORDER } from '@/components/task-detail/priority';
import { PriorityGlyph } from '@/components/task-detail/PriorityGlyph';

/**
 * The bounded {@link Priority} choices, ordered most→least pressing, each with its glyph.
 *
 * @remarks
 * Priority is non-nullable (`none` is its own explicit level), so the enum picker never offers a
 * "clear" row — an unset priority resolves to `none`.
 */
export const PRIORITY_OPTIONS: readonly PickerOption<Priority>[] = PRIORITY_ORDER.map(
  (priority) => ({
    value: priority,
    label: PRIORITY_LABEL[priority],
    icon: <PriorityGlyph priority={priority} />,
  }),
);

/** The canonical health ordering for the picker (best → worst). */
const HEALTH_ORDER: readonly Health[] = ['on_track', 'at_risk', 'off_track'];

/**
 * The {@link Health} verdict choices, each with a solid color dot.
 *
 * @remarks
 * Health is *nullable* on projects/programs/initiatives, so the enum picker that consumes this
 * should pass a `clearLabel` (e.g. "No health") to offer the unset row.
 */
export const HEALTH_OPTIONS: readonly PickerOption<Health>[] = HEALTH_ORDER.map((health) => ({
  value: health,
  label: HEALTH_LABEL[health],
  icon: <span className={`size-2.5 rounded-full ${HEALTH_DOT_CLASS[health]}`} aria-hidden />,
}));

/** Human label for each {@link ProjectStatus}. */
const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planned: 'Planned',
  active: 'Active',
  completed: 'Completed',
  canceled: 'Canceled',
};

/** The canonical project-status ordering for the picker menu. */
const PROJECT_STATUS_ORDER: readonly ProjectStatus[] = [
  'planned',
  'active',
  'completed',
  'canceled',
];

/**
 * The {@link ProjectStatus} enum choices (lifecycle order), each carrying the exact
 * {@link StatusIcon} glyph the Projects list row already shows for that status (via
 * {@link projectStatusGlyphType}) — no new icon, the same one reused so the picker and the row
 * agree.
 */
export const PROJECT_STATUS_OPTIONS: readonly PickerOption<ProjectStatus>[] =
  PROJECT_STATUS_ORDER.map((status) => ({
    value: status,
    label: PROJECT_STATUS_LABEL[status],
    icon: <StatusIcon type={projectStatusGlyphType(status)} />,
  }));

/** Human label for each {@link ProgramStatus}. */
const PROGRAM_STATUS_LABEL: Record<ProgramStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
};

/** The canonical program-status ordering for the picker menu. */
const PROGRAM_STATUS_ORDER: readonly ProgramStatus[] = ['active', 'paused', 'archived'];

/**
 * The {@link ProgramStatus} enum choices, each carrying the exact {@link StatusIcon} glyph the
 * Programs list row already shows for that status (via {@link programStatusGlyphType}).
 */
export const PROGRAM_STATUS_OPTIONS: readonly PickerOption<ProgramStatus>[] =
  PROGRAM_STATUS_ORDER.map((status) => ({
    value: status,
    label: PROGRAM_STATUS_LABEL[status],
    icon: <StatusIcon type={programStatusGlyphType(status)} />,
  }));

/** Human label for each {@link InitiativeStatus}. */
const INITIATIVE_STATUS_LABEL: Record<InitiativeStatus, string> = {
  proposed: 'Proposed',
  active: 'Active',
  completed: 'Completed',
  canceled: 'Canceled',
};

/** The canonical initiative-status ordering for the picker menu. */
const INITIATIVE_STATUS_ORDER: readonly InitiativeStatus[] = [
  'proposed',
  'active',
  'completed',
  'canceled',
];

/**
 * The {@link InitiativeStatus} enum choices.
 *
 * @remarks
 * Deliberately icon-less, unlike its project/program/cycle siblings above: no other surface in
 * the product renders an initiative-status glyph today (no `components/initiatives/*-status.tsx`
 * analogous to the project/program/cycle ones exists), so there is no existing icon to reuse here
 * without inventing a new one.
 */
export const INITIATIVE_STATUS_OPTIONS: readonly PickerOption<InitiativeStatus>[] =
  INITIATIVE_STATUS_ORDER.map((status) => ({ value: status, label: INITIATIVE_STATUS_LABEL[status] }));

/** Human label for each {@link CycleStatus}. */
const CYCLE_STATUS_LABEL: Record<CycleStatus, string> = {
  upcoming: 'Upcoming',
  active: 'Active',
  completed: 'Completed',
};

/** The canonical cycle-status ordering for the picker menu. */
const CYCLE_STATUS_ORDER: readonly CycleStatus[] = ['upcoming', 'active', 'completed'];

/**
 * The {@link CycleStatus} enum choices, each carrying the exact {@link StatusIcon} glyph a cycle
 * row already shows for that status (via {@link cycleStatusGlyphType}).
 */
export const CYCLE_STATUS_OPTIONS: readonly PickerOption<CycleStatus>[] = CYCLE_STATUS_ORDER.map(
  (status) => ({
    value: status,
    label: CYCLE_STATUS_LABEL[status],
    icon: <StatusIcon type={cycleStatusGlyphType(status)} />,
  }),
);

/** Human label for each {@link Visibility}. */
const VISIBILITY_LABEL: Record<Visibility, string> = {
  public: 'Public',
  private: 'Private',
};

/**
 * What each {@link Visibility} actually does, in the reader's terms.
 *
 * @remarks
 * The picker used to offer two bare words with nothing to distinguish them, which left people
 * guessing at what they were choosing — the launch note is literally "It's unclear what
 * public/private is really doing."
 *
 * This copy states the effect the system actually has today, not the effect the words imply.
 * Visibility is enforced in workspace search (`apps/api/src/search/query.ts` —
 * `publicByMembership = fact.visibility === 'public' && !access.isGuest`): a public object is
 * reachable by every member who is not a guest, and a private one only by someone holding an
 * explicit grant. It is deliberately NOT described as "nobody else can open it", because the
 * programs list and detail routes do not yet apply the same predicate — saying so would be a
 * promise the product does not keep.
 */
const VISIBILITY_DESCRIPTION: Record<Visibility, string> = {
  public: 'Anyone in this workspace can find it in search.',
  private: 'Kept out of search for anyone without access to it.',
};

/** The {@link Visibility} enum choices (public, then private), each explaining itself. */
export const VISIBILITY_OPTIONS: readonly PickerOption<Visibility>[] = (
  ['public', 'private'] as const
).map((visibility) => ({
  value: visibility,
  label: VISIBILITY_LABEL[visibility],
  supporting: VISIBILITY_DESCRIPTION[visibility],
  icon: visibility === 'public' ? <Globe className="size-4" /> : <Shield className="size-4" />,
}));

/** Build a generic enum option list from ordered literals and a label map (no icon). */
export function enumOptions<TValue extends string>(
  order: readonly TValue[],
  labels: Record<TValue, string>,
): readonly PickerOption<TValue>[] {
  return order.map((value) => ({ value, label: labels[value] }));
}

/**
 * Map the org's human members + agents into searchable actor options.
 *
 * @remarks
 * Humans come from `GET /members` (with their avatar + email for search); agents come from
 * `GET /agents` (tagged with the agent {@link ActorAvatar} kind so automated actors read as
 * non-human). When an actor id appears in both lists the agent treatment wins. The display label
 * for an agent falls back to a short "Agent" tag when no member row names it (the agents read
 * carries only the actor id), matching the resolveActor pattern on the task detail screen.
 */
export function actorOptions(
  members: readonly MemberOut[],
  agents: readonly AgentOut[] = [],
): readonly PickerOption[] {
  const agentActorIds = new Set(agents.map((agent) => agent.actorId));
  const options: PickerOption[] = members.map((member) => ({
    value: member.actorId,
    label: member.displayName,
    icon: (
      <ActorAvatar
        kind={agentActorIds.has(member.actorId) ? 'agent' : 'human'}
        name={member.displayName}
        avatarUrl={member.avatar}
        size={20}
      />
    ),
  }));
  // Agents with no naming member row still need to be selectable.
  const named = new Set(members.map((member) => member.actorId));
  for (const agent of agents) {
    if (named.has(agent.actorId)) continue;
    options.push({
      value: agent.actorId,
      label: 'Agent',
      icon: <ActorAvatar kind="agent" name="Agent" size={20} />,
    });
  }
  return options;
}

/**
 * Build actor options (assignee / lead / owner) from the org's members only.
 *
 * @remarks
 * Each option carries the member's {@link ActorAvatar} as its glyph. Agents are intentionally
 * omitted here — unlike {@link actorOptions}, this is for the human-accountability slots (lead,
 * owner) rather than a general assignee field.
 */
export function memberActorOptions(members: readonly MemberOut[]): readonly PickerOption[] {
  return members.map((member) => ({
    value: member.actorId,
    label: member.displayName,
    icon: (
      <ActorAvatar kind="human" name={member.displayName} avatarUrl={member.avatar} size={20} />
    ),
  }));
}

/** Map the org's projects into entity options. */
export function projectOptions(projects: readonly ProjectOut[]): readonly PickerOption[] {
  return projects.map((project) => ({ value: project.id, label: project.name }));
}

/** Map the org's programs into entity options. */
export function programOptions(programs: readonly ProgramOut[]): readonly PickerOption[] {
  return programs.map((program) => ({ value: program.id, label: program.name }));
}

/** Map the org's initiatives into entity options. */
export function initiativeOptions(initiatives: readonly InitiativeOut[]): readonly PickerOption[] {
  return initiatives.map((initiative) => ({ value: initiative.id, label: initiative.name }));
}

/**
 * Map a team's cycles into entity options.
 *
 * @remarks
 * Labels are the cycle's server-derived `displayName` — the author's name when it has one,
 * otherwise its window ("Jul 27 – Aug 2"), matching how a cycle renders everywhere else. The
 * window rides along as the muted `hint`, but only when it adds information: for an unnamed cycle
 * the label *is* the window, so repeating it would print the same string twice in one row. The
 * vocabulary-skinned cycle noun is deliberately not a parameter: a cycle now names itself, so
 * there is nothing left for the noun to prefix.
 *
 * @param cycles - The cycles to offer.
 * @param formatWindow - Formats a cycle's start/end into a short window hint.
 * @returns one {@link PickerOption} per cycle, keyed by id.
 */
export function cycleOptions(
  cycles: readonly CycleOut[],
  formatWindow: (startsAt: string, endsAt: string) => string,
): readonly PickerOption[] {
  return cycles.map((cycle) => {
    const window = formatWindow(cycle.startsAt, cycle.endsAt);
    return {
      value: cycle.id,
      label: cycle.displayName,
      ...(window === cycle.displayName ? {} : { hint: window }),
    };
  });
}

/**
 * Map a team's ordered workflow states into enum options.
 *
 * @remarks
 * The option `value` is the state `key` (what `task.state` stores), the label is the team's
 * human name, and the icon is the canonical {@link StatusIcon} keyed off the state `type`.
 */
export function workflowStateOptions(states: readonly WorkflowState[]): readonly PickerOption[] {
  return states.map((state) => ({
    value: state.key,
    label: state.name,
    icon: <StatusIcon type={state.type} />,
  }));
}

/** Map the org's labels into multi-select options, each with its color swatch. */
export function labelOptions(labels: readonly LabelOut[]): readonly PickerOption[] {
  return labels.map((label) => ({
    value: label.id,
    label: label.name,
    icon: (
      <span
        className="size-2.5 rounded-full"
        style={{ background: label.color }}
        aria-hidden="true"
      />
    ),
  }));
}
