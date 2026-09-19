'use client';

/**
 * `components/plan-canvas/plan-assignment-fields` — who and which team, picked from the roster.
 *
 * @remarks
 * The plan's roster names every active person in the workspace with the teams they are on, and
 * every live team. A node that carries a team (a project or a task) picks the team first; the
 * person picker then lists only that team's people, so a feature task goes to someone on
 * Product and an engineering subtask to someone on Engineering. The pickers show names and store
 * ids. Avatars come from the workspace's member options when the roster's person is among them.
 */
import type { PickerOption } from '@docket/ui/components';
import { ActorPicker, EnumPicker } from '@docket/ui/components';
import type { PlanNode, PlanRoster } from '@docket/work/plan-draft-contract';
import { type JSX, type ReactNode, useMemo } from 'react';

/** The classes a picker trigger takes so it reads as a field beside the text fields. */
export const FIELD_TRIGGER =
  'bg-surface-container-highest hover:bg-surface-container-high w-full justify-start';

/** Props for {@link PlanFieldRow}. */
export interface PlanFieldRowProps {
  readonly label: string;
  readonly children: ReactNode;
}

/** A labelled row wrapping a picker that reads as a field. */
export function PlanFieldRow({ label, children }: PlanFieldRowProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-on-surface-variant text-label-medium">{label}</span>
      {children}
    </div>
  );
}

/** The person fields a node may carry. */
export type PersonKey = 'ownerId' | 'leadId' | 'assigneeId';

/** The person field a kind carries. */
export interface PersonField {
  readonly key: PersonKey;
  readonly label: string;
  readonly placeholder: string;
  readonly clearLabel: string;
}

/** The person field for a kind: owner, lead, or assignee. */
export function personField(kind: PlanNode['kind']): PersonField {
  switch (kind) {
    case 'initiative':
    case 'program':
      return { key: 'ownerId', label: 'Owner', placeholder: 'Set owner', clearLabel: 'No owner' };
    case 'project':
      return { key: 'leadId', label: 'Lead', placeholder: 'Set lead', clearLabel: 'No lead' };
    case 'task':
      return {
        key: 'assigneeId',
        label: 'Assignee',
        placeholder: 'Assign',
        clearLabel: 'Unassigned',
      };
  }
}

/** Whether a kind carries an owning team. */
export function carriesTeam(kind: PlanNode['kind']): boolean {
  return kind === 'project' || kind === 'task';
}

/** What {@link rosterPersonOptions} reads. */
export interface RosterPersonInput {
  readonly roster: PlanRoster;
  /** The workspace's member options, for their avatars. */
  readonly memberOptions: readonly PickerOption[];
  /** The node's team; people off it are left out. Null lists everyone. */
  readonly teamId: string | null;
  /** The person set now, kept in the list so the field still names them. */
  readonly currentId: string | null;
}

/**
 * The people a node may name, as picker options: the roster's people, narrowed to the node's team
 * when one is set, each hinted with the teams they are on when the list is not narrowed.
 *
 * @returns options whose values are actor ids and whose labels are names; the member options
 *   alone while the roster has no people yet.
 */
export function rosterPersonOptions({
  roster,
  memberOptions,
  teamId,
  currentId,
}: RosterPersonInput): readonly PickerOption[] {
  if (roster.people.length === 0) return memberOptions;
  const teamName = new Map(roster.teams.map((team) => [team.id, team.name]));
  const iconOf = new Map(memberOptions.map((option) => [option.value, option.icon]));
  return roster.people
    .filter(
      (person) =>
        teamId === null ||
        (person.teamIds as readonly string[]).includes(teamId) ||
        person.actorId === currentId,
    )
    .map((person) => {
      const teams = person.teamIds
        .map((id) => teamName.get(id))
        .filter((name): name is string => name !== undefined);
      return {
        value: person.actorId,
        label: person.name,
        icon: iconOf.get(person.actorId),
        ...(teamId === null && teams.length > 0 ? { hint: teams.join(', ') } : {}),
      };
    });
}

/** Props for {@link PlanAssignmentFields}. */
export interface PlanAssignmentFieldsProps {
  readonly node: PlanNode;
  readonly roster: PlanRoster;
  readonly memberOptions: readonly PickerOption[];
  readonly canEdit: boolean;
  readonly setField: (fields: Record<string, unknown>) => void;
}

/** The team a node goes to, then the person on it. */
export function PlanAssignmentFields({
  node,
  roster,
  memberOptions,
  canEdit,
  setField,
}: PlanAssignmentFieldsProps): JSX.Element {
  const person = personField(node.kind);
  const withTeam = carriesTeam(node.kind);
  const teamId = withTeam ? (node.fields.teamId ?? null) : null;
  const currentId = node.fields[person.key] ?? null;
  const teamOptions = useMemo<readonly PickerOption[]>(
    () => roster.teams.map((team) => ({ value: team.id, label: team.name })),
    [roster.teams],
  );
  const people = useMemo(
    () => rosterPersonOptions({ roster, memberOptions, teamId, currentId }),
    [roster, memberOptions, teamId, currentId],
  );
  return (
    <>
      {withTeam ? (
        <PlanFieldRow label="Team">
          <EnumPicker
            options={teamOptions}
            value={teamId}
            placeholder="Set team"
            clearLabel="No team"
            ariaLabel="Team"
            disabled={!canEdit || teamOptions.length === 0}
            triggerVariant="ghost"
            triggerClassName={FIELD_TRIGGER}
            onChange={(value) => {
              setField({ teamId: value });
            }}
          />
        </PlanFieldRow>
      ) : null}
      <PlanFieldRow label={person.label}>
        <ActorPicker
          options={people}
          value={currentId}
          placeholder={person.placeholder}
          clearLabel={person.clearLabel}
          ariaLabel={person.label}
          idleText="Nobody on this team"
          disabled={!canEdit}
          triggerVariant="ghost"
          triggerClassName={FIELD_TRIGGER}
          onChange={(value) => {
            setField({ [person.key]: value });
          }}
        />
      </PlanFieldRow>
    </>
  );
}
