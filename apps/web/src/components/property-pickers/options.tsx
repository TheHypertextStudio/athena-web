'use client';

/**
 * Shared option builders + enum metadata for the inline property pickers.
 *
 * @remarks
 * Directive A asks every detail-surface property to be an interactive picker rather than a dead
 * "Not set" row. The picker shells in `@docket/ui` are presentational: they take a pre-resolved
 * {@link PickerOption}[] and report a chosen value. This module is the single place the web app
 * turns its loaded domain data — members, projects, programs, initiatives, cycles, labels — and
 * its lifecycle enums — health, project/program/initiative/cycle status, priority — into those
 * options, so the project / task / program / initiative / cycle detail panels all build their
 * pickers identically (same glyphs, same vocabulary-skinned nouns, same ordering).
 *
 * Every builder is pure so the panels memoize it against the loaded lists; the panels own the
 * optimistic PATCH and the capability gate.
 */
import {
  type CycleOut,
  type CycleStatus,
  type Health,
  type InitiativeOut,
  type InitiativeStatus,
  type MemberOut,
  type Priority,
  type ProgramOut,
  type ProgramStatus,
  type ProjectOut,
  type ProjectStatus,
  type Visibility,
} from '@docket/types';
import { ActorAvatar, StatusIcon } from '@docket/ui/components';
import { Globe, Shield } from '@docket/ui/icons';
import type { PickerOption } from '@docket/ui/components';
import { cn } from '@docket/ui';
import type { JSX, ReactNode } from 'react';

import { statusGlyphType as cycleStatusGlyphType } from '@/components/cycles/cycle-status';
import { statusGlyphType as programStatusGlyphType } from '@/components/programs/program-status';
import { statusGlyphType as projectStatusGlyphType } from '@/components/projects/project-status';
import { PRIORITY_LABEL, PRIORITY_ORDER } from '@/components/task-detail/priority';
import { PriorityGlyph } from '@/components/task-detail/PriorityGlyph';

/** The token-backed dot color for each {@link Health} verdict (and the unset case). */
const HEALTH_DOT_CLASS: Record<Health, string> = {
  on_track: 'bg-state-completed',
  at_risk: 'bg-state-canceled',
  off_track: 'bg-destructive',
};

/** Human label for each {@link Health} verdict. */
const HEALTH_LABEL: Record<Health, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
};

/** The canonical health ordering for the picker menu (best → worst). */
const HEALTH_ORDER: readonly Health[] = ['on_track', 'at_risk', 'off_track'];

/** A small solid health dot glyph, token-colored, for a health picker option/trigger. */
export function HealthDot({ health }: { health: Health }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-2.5 rounded-full', HEALTH_DOT_CLASS[health])}
    />
  );
}

/** Build the {@link Health} enum options (best → worst), each with its colored dot. */
export function healthOptions(): readonly PickerOption<Health>[] {
  return HEALTH_ORDER.map((health) => ({
    value: health,
    label: HEALTH_LABEL[health],
    icon: <HealthDot health={health} />,
  }));
}

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
 * Build the {@link ProjectStatus} enum options (lifecycle order), each carrying the exact
 * {@link StatusIcon} glyph the Projects list row already shows for that status (via
 * {@link projectStatusGlyphType} from `components/projects/project-status.tsx`) — no new icon,
 * the same one reused so the picker and the row agree.
 */
export function projectStatusOptions(): readonly PickerOption<ProjectStatus>[] {
  return PROJECT_STATUS_ORDER.map((status) => ({
    value: status,
    label: PROJECT_STATUS_LABEL[status],
    icon: <StatusIcon type={projectStatusGlyphType(status)} />,
  }));
}

/** Human label for each {@link ProgramStatus}. */
const PROGRAM_STATUS_LABEL: Record<ProgramStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
};

/** The canonical program-status ordering for the picker menu. */
const PROGRAM_STATUS_ORDER: readonly ProgramStatus[] = ['active', 'paused', 'archived'];

/**
 * Build the {@link ProgramStatus} enum options, each carrying the exact {@link StatusIcon} glyph
 * the Programs list row already shows for that status (via {@link programStatusGlyphType} from
 * `components/programs/program-status.tsx`).
 */
export function programStatusOptions(): readonly PickerOption<ProgramStatus>[] {
  return PROGRAM_STATUS_ORDER.map((status) => ({
    value: status,
    label: PROGRAM_STATUS_LABEL[status],
    icon: <StatusIcon type={programStatusGlyphType(status)} />,
  }));
}

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
 * Build the {@link InitiativeStatus} enum options.
 *
 * @remarks
 * Deliberately icon-less, unlike its project/program/cycle siblings above: no other surface in
 * the product renders an initiative-status glyph today (no `components/initiatives/*-status.tsx`
 * analogous to the project/program/cycle ones exists), so there is no existing icon to reuse
 * here without inventing a new one.
 */
export function initiativeStatusOptions(): readonly PickerOption<InitiativeStatus>[] {
  return INITIATIVE_STATUS_ORDER.map((status) => ({
    value: status,
    label: INITIATIVE_STATUS_LABEL[status],
  }));
}

/** Human label for each {@link CycleStatus}. */
const CYCLE_STATUS_LABEL: Record<CycleStatus, string> = {
  upcoming: 'Upcoming',
  active: 'Active',
  completed: 'Completed',
};

/** The canonical cycle-status ordering for the picker menu. */
const CYCLE_STATUS_ORDER: readonly CycleStatus[] = ['upcoming', 'active', 'completed'];

/**
 * Build the {@link CycleStatus} enum options, each carrying the exact {@link StatusIcon} glyph a
 * cycle row already shows for that status (via {@link cycleStatusGlyphType} from
 * `components/cycles/cycle-status.ts`).
 */
export function cycleStatusOptions(): readonly PickerOption<CycleStatus>[] {
  return CYCLE_STATUS_ORDER.map((status) => ({
    value: status,
    label: CYCLE_STATUS_LABEL[status],
    icon: <StatusIcon type={cycleStatusGlyphType(status)} />,
  }));
}

/** Build the {@link Priority} enum options (urgent → none), each with its three-bar glyph. */
export function priorityOptions(): readonly PickerOption<Priority>[] {
  return PRIORITY_ORDER.map((priority) => ({
    value: priority,
    label: PRIORITY_LABEL[priority],
    icon: <PriorityGlyph priority={priority} />,
  }));
}

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
 *
 * @see {@link visibilityOptions} for the picker rows this copy appears in.
 */
export const VISIBILITY_DESCRIPTION: Record<Visibility, string> = {
  public: 'Anyone in this workspace can find it in search.',
  private: 'Kept out of search for anyone without access to it.',
};

/** Build the {@link Visibility} enum options (public, then private), each explaining itself. */
export function visibilityOptions(): readonly PickerOption<Visibility>[] {
  return (['public', 'private'] as const).map((visibility) => ({
    value: visibility,
    label: VISIBILITY_LABEL[visibility],
    supporting: VISIBILITY_DESCRIPTION[visibility],
    icon: visibility === 'public' ? <Globe className="size-4" /> : <Shield className="size-4" />,
  }));
}

/**
 * Build actor options (assignee / lead / owner) from the org's members.
 *
 * @remarks
 * Each option carries the member's {@link ActorAvatar} as its glyph and folds the member's
 * email-less display name into the searchable label; agents are intentionally omitted here
 * because the editable "who" fields (lead / owner / assignee) are human accountability slots.
 *
 * @param members - The org's human members.
 * @returns one {@link PickerOption} per member, keyed by `actorId`.
 */
export function memberActorOptions(members: readonly MemberOut[]): readonly PickerOption[] {
  return members.map((member) => ({
    value: member.actorId,
    label: member.displayName,
    icon: (
      <ActorAvatar
        kind="human"
        name={member.displayName}
        avatarUrl={member.avatar ?? undefined}
        size={20}
      />
    ),
  }));
}

/** A small neutral glyph node for an entity-picker option (a quiet leading dot). */
function entityGlyph(icon: ReactNode): ReactNode {
  return icon;
}

/** Build project options from the org's projects. */
export function projectOptions(projects: readonly ProjectOut[]): readonly PickerOption[] {
  return projects.map((project) => ({ value: project.id, label: project.name }));
}

/** Build program options from the org's programs. */
export function programOptions(programs: readonly ProgramOut[]): readonly PickerOption[] {
  return programs.map((program) => ({ value: program.id, label: program.name }));
}

/** Build initiative options from the org's initiatives. */
export function initiativeOptions(initiatives: readonly InitiativeOut[]): readonly PickerOption[] {
  return initiatives.map((initiative) => ({ value: initiative.id, label: initiative.name }));
}

/**
 * Build cycle options from the org's cycles.
 *
 * @remarks
 * The option label is the cycle's server-derived `displayName` — the author's name when it has
 * one, otherwise its window ("Jul 27 – Aug 2"). It used to fall back to `Cycle <number>`, but that
 * number is the epoch-anchored auto-roll key (1000137) and means nothing to a reader.
 *
 * The window rides along as the muted `hint`, but only when it adds information: for an unnamed
 * cycle the label *is* the window, so repeating it would print the same string twice in one row.
 *
 * The vocabulary-skinned cycle noun is deliberately not a parameter: a cycle now names itself, so
 * there is nothing left for the noun to prefix.
 *
 * @param cycles - The org's cycles.
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

/** Build label options from the org's labels, each with its color swatch as its glyph. */
export function labelOptions(
  labels: readonly { id: string; name: string; color: string }[],
): readonly PickerOption[] {
  return labels.map((label) => ({
    value: label.id,
    label: label.name,
    icon: entityGlyph(
      <span
        aria-hidden="true"
        className="inline-block size-2.5 rounded-full"
        style={{ background: label.color }}
      />,
    ),
  }));
}
