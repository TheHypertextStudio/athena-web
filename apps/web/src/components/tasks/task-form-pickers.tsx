'use client';

import type { EstimationScale, Priority, TeamOut } from '@docket/types';
import {
  ActorPicker,
  DatePicker,
  EntityPicker,
  EnumPicker,
  LabelsPicker,
  type PickerOption,
} from '@docket/ui/components';
import { Flag, FolderKanban, RefreshCw } from '@docket/ui/icons';
import type { JSX } from 'react';

import { PRIORITY_OPTIONS } from '@/components/pickers/options';
import { EstimatePicker } from '@/components/task-detail/EstimatePicker';
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
  milestoneId: string | null;
  milestoneOptionsForProject: readonly { value: string; label: string }[];
  cycleId: string | null;
  cycleOptionsForTeam: readonly { value: string; label: string }[];
  cycleNoun: string;
  startDate: string | null;
  dueDate: string | null;
  labelIds: readonly string[];
  labelOptions: readonly PickerOption[];
  /** The workspace's configured estimation scale, or `null` while it loads. */
  estimationScale: EstimationScale | null;
  estimate: number | null;
  creating: boolean;
  onTeamChange: (id: string | null) => void;
  onStateChange: (state: string | null) => void;
  onPriorityChange: (priority: Priority) => void;
  onAssigneeChange: (id: string | null) => void;
  onProjectChange: (id: string | null) => void;
  onMilestoneChange: (id: string | null) => void;
  onCycleChange: (id: string | null) => void;
  onStartDateChange: (d: string | null) => void;
  onDueDateChange: (d: string | null) => void;
  onLabelToggle: (id: string) => void;
  onEstimateChange: (value: number | null) => void;
}

function triggerDate(value: string | null): string | undefined {
  return formatCalendarDate(value, { month: 'short', day: 'numeric' }) ?? undefined;
}

/** TaskComposerPickers renders the task UI control for its parent workflow. */
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
  milestoneId,
  milestoneOptionsForProject,
  cycleId,
  cycleOptionsForTeam,
  cycleNoun,
  startDate,
  dueDate,
  labelIds,
  labelOptions,
  estimationScale,
  estimate,
  creating,
  onTeamChange,
  onStateChange,
  onPriorityChange,
  onAssigneeChange,
  onProjectChange,
  onMilestoneChange,
  onCycleChange,
  onStartDateChange,
  onDueDateChange,
  onLabelToggle,
  onEstimateChange,
}: TaskComposerPickersProps): JSX.Element {
  const projectNounLower = projectNoun.toLowerCase();
  const cycleNounLower = cycleNoun.toLowerCase();

  return (
    <>
      <TeamPicker teams={teams} value={teamId} onChange={onTeamChange} disabled={creating} />
      {statusOptions.length > 0 ? (
        <EnumPicker
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
        options={actorOptions}
        value={assigneeId}
        onChange={onAssigneeChange}
        placeholder="Assignee"
        clearLabel="Unassigned"
        ariaLabel="Assignee"
        disabled={creating}
      />
      <EntityPicker
        options={projectOptions}
        value={projectId}
        onChange={onProjectChange}
        placeholder={`Set ${projectNounLower}`}
        triggerIcon={<FolderKanban className="text-on-surface-variant size-4" />}
        clearLabel={`No ${projectNounLower}`}
        searchPlaceholder={`Search ${projectNounLower}s…`}
        ariaLabel={projectNoun}
        disabled={creating}
      />
      <EntityPicker
        options={milestoneOptionsForProject}
        value={milestoneId}
        onChange={onMilestoneChange}
        placeholder={projectId ? 'Set milestone' : `Set a ${projectNounLower} first`}
        triggerIcon={<Flag className="text-on-surface-variant size-4" />}
        clearLabel="No milestone"
        searchPlaceholder="Search milestones…"
        emptyText={projectId ? 'No milestones' : `Set a ${projectNounLower} to choose a milestone`}
        ariaLabel="Milestone"
        disabled={creating || !projectId}
      />
      {cycleOptionsForTeam.length > 0 ? (
        <EntityPicker
          options={cycleOptionsForTeam}
          value={cycleId}
          onChange={onCycleChange}
          placeholder={`Set ${cycleNounLower}`}
          triggerIcon={<RefreshCw className="text-on-surface-variant size-4" />}
          clearLabel={`No ${cycleNounLower}`}
          searchPlaceholder={`Search ${cycleNounLower}s…`}
          ariaLabel={cycleNoun}
          disabled={creating}
        />
      ) : null}
      <DatePicker
        value={startDate}
        onChange={onStartDateChange}
        placeholder="Anticipated start"
        formatLabel={triggerDate}
        ariaLabel="Anticipated start"
        disabled={creating}
      />
      <DatePicker
        value={dueDate}
        onChange={onDueDateChange}
        placeholder="Due date"
        formatLabel={triggerDate}
        ariaLabel="Due date"
        disabled={creating}
      />
      <LabelsPicker
        options={labelOptions}
        value={labelIds}
        onToggle={onLabelToggle}
        placeholder="Labels"
        ariaLabel="Labels"
        disabled={creating}
      />
      {estimationScale && estimationScale !== 'none' ? (
        <EstimatePicker
          scale={estimationScale}
          value={estimate}
          onChange={onEstimateChange}
          disabled={creating}
        />
      ) : null}
    </>
  );
}
