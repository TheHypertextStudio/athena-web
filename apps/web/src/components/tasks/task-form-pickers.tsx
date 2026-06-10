'use client';

import type { Priority, TeamOut } from '@docket/types';
import {
  ActorPicker,
  DatePicker,
  EntityPicker,
  EnumPicker,
  LabelsPicker,
  type PickerOption,
} from '@docket/ui/components';
import type { JSX } from 'react';

import { PRIORITY_OPTIONS } from '@/components/pickers/options';
import { TeamPicker } from '@/components/teams/team-picker';
import { formatCalendarDate } from '@/lib/format-date';

interface TaskComposerPickersProps {
  teams: readonly TeamOut[];
  teamId: string | null;
  statusOptions: readonly { value: string; label: string }[];
  state: string | null;
  priority: Priority;
  assigneeId: string | null;
  actorOptions: readonly PickerOption[];
  projectId: string | null;
  projectOptions: readonly PickerOption[];
  projectNoun: string;
  cycleId: string | null;
  cycleOptionsForTeam: readonly { value: string; label: string }[];
  cycleNoun: string;
  dueDate: string | null;
  labelIds: readonly string[];
  labelOptions: readonly PickerOption[];
  creating: boolean;
  onTeamChange: (id: string | null) => void;
  onStateChange: (state: string | null) => void;
  onPriorityChange: (priority: Priority) => void;
  onAssigneeChange: (id: string | null) => void;
  onProjectChange: (id: string | null) => void;
  onCycleChange: (id: string | null) => void;
  onDueDateChange: (d: string | null) => void;
  onLabelToggle: (id: string) => void;
}

function triggerDate(value: string | null): string | undefined {
  return formatCalendarDate(value, { month: 'short', day: 'numeric' }) ?? undefined;
}

export function TaskComposerPickers({
  teams,
  teamId,
  statusOptions,
  state,
  priority,
  assigneeId,
  actorOptions,
  projectId,
  projectOptions,
  projectNoun,
  cycleId,
  cycleOptionsForTeam,
  cycleNoun,
  dueDate,
  labelIds,
  labelOptions,
  creating,
  onTeamChange,
  onStateChange,
  onPriorityChange,
  onAssigneeChange,
  onProjectChange,
  onCycleChange,
  onDueDateChange,
  onLabelToggle,
}: TaskComposerPickersProps): JSX.Element {
  const projectNounLower = projectNoun.toLowerCase();
  const cycleNounLower = cycleNoun.toLowerCase();

  return (
    <>
      <TeamPicker
        teams={teams}
        value={teamId}
        onChange={onTeamChange}
        disabled={creating}
        className="h-8"
      />
      {statusOptions.length > 0 ? (
        <EnumPicker
          triggerVariant="outline"
          options={statusOptions}
          value={state}
          onChange={(next) => {
            if (next) onStateChange(next);
          }}
          placeholder="Status"
          ariaLabel="Status"
          disabled={creating}
        />
      ) : null}
      <EnumPicker
        triggerVariant="outline"
        options={PRIORITY_OPTIONS}
        value={priority}
        onChange={(next) => {
          onPriorityChange(next ?? 'none');
        }}
        placeholder="Priority"
        ariaLabel="Priority"
        disabled={creating}
      />
      <ActorPicker
        triggerVariant="outline"
        options={actorOptions}
        value={assigneeId}
        onChange={onAssigneeChange}
        placeholder="Assignee"
        clearLabel="Unassigned"
        ariaLabel="Assignee"
        disabled={creating}
      />
      <EntityPicker
        triggerVariant="outline"
        options={projectOptions}
        value={projectId}
        onChange={onProjectChange}
        placeholder={`Set ${projectNounLower}`}
        clearLabel={`No ${projectNounLower}`}
        searchPlaceholder={`Search ${projectNounLower}s…`}
        ariaLabel={projectNoun}
        disabled={creating}
      />
      {cycleOptionsForTeam.length > 0 ? (
        <EntityPicker
          triggerVariant="outline"
          options={cycleOptionsForTeam}
          value={cycleId}
          onChange={onCycleChange}
          placeholder={`Set ${cycleNounLower}`}
          clearLabel={`No ${cycleNounLower}`}
          searchPlaceholder={`Search ${cycleNounLower}s…`}
          ariaLabel={cycleNoun}
          disabled={creating}
        />
      ) : null}
      <DatePicker
        triggerVariant="outline"
        value={dueDate}
        onChange={onDueDateChange}
        placeholder="Due date"
        formatLabel={triggerDate}
        ariaLabel="Due date"
        disabled={creating}
      />
      <LabelsPicker
        triggerVariant="outline"
        options={labelOptions}
        value={labelIds}
        onToggle={onLabelToggle}
        placeholder="Labels"
        ariaLabel="Labels"
        disabled={creating}
      />
    </>
  );
}
