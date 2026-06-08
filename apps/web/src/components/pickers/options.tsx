/**
 * Pure option-sourcing mappers that feed the `@docket/ui` compact property pickers.
 *
 * @remarks
 * The picker shells in `@docket/ui` are intentionally *presentational*: each takes a plain,
 * pre-resolved array of {@link PickerOption}s and reports a chosen value through `onChange`. The
 * app owns the data, so these helpers translate the org's DTOs — members, agents, projects,
 * programs, initiatives, cycles, teams, labels — and the bounded enums (priority, health, the
 * lifecycle statuses) into option arrays. Keeping them pure (no React, no RPC) means they are
 * trivially unit-testable and reused by BOTH the detail property panels (other lane) and the
 * create composers (this lane).
 *
 * Icons are returned as React nodes (an {@link ActorAvatar}, a {@link PriorityGlyph}, a
 * {@link StatusIcon}, a health/label swatch) so the picker rows read at a glance; that is why
 * this module is a `.tsx`-adjacent `.ts` exception — it emits JSX and therefore lives as `.tsx`.
 *
 * @see {@link useComposerOptions} for the hook that fetches the data these map over.
 */
import type {
  AgentOut,
  CycleOut,
  Health,
  InitiativeOut,
  LabelOut,
  MemberOut,
  Priority,
  ProgramOut,
  ProjectOut,
  WorkflowState,
} from '@docket/types';
import { ActorAvatar, type PickerOption, StatusIcon } from '@docket/ui/components';

import { HEALTH_LABEL } from '@/components/project-detail/health';
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

/** A small solid health swatch token class, keyed by verdict (mirrors the health pill colors). */
const HEALTH_SWATCH_CLASS: Record<Health, string> = {
  on_track: 'bg-state-completed',
  at_risk: 'bg-state-canceled',
  off_track: 'bg-destructive',
};

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
  icon: <span className={`size-2.5 rounded-full ${HEALTH_SWATCH_CLASS[health]}`} aria-hidden />,
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
 * A cycle's display name is optional; unnamed cycles read as "Cycle N" off the team-local
 * sequence number, matching how they render everywhere else.
 */
export function cycleOptions(
  cycles: readonly CycleOut[],
  cycleNoun = 'Cycle',
): readonly PickerOption[] {
  return cycles.map((cycle) => ({
    value: cycle.id,
    label: cycle.name ?? `${cycleNoun} ${String(cycle.number)}`,
  }));
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
