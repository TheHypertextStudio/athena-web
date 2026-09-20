'use client';

import type { EstimationScale } from '../../lib/contracts/organization';
import type { Priority } from '@docket/work/task-contract';
import {
  DatePicker,
  EntityPicker,
  EnumPicker,
  LabelsPicker,
  type PickerOption,
} from '@docket/ui/components';
import { Flag, FolderKanban } from '@docket/ui/icons';
import type { JSX } from 'react';

import { PRIORITY_OPTIONS } from '@/components/pickers/options';
import { FutureCyclePicker } from '@/components/pickers/future-cycle-picker';
import { PersonMetadataPicker } from '@/components/people/person-metadata-picker';
import { EstimatePicker } from '@/components/task-detail/EstimatePicker';
import { EntityMetadataItem } from '@/components/views/entity-detail-layout';
import { formatCalendarDate } from '@/lib/format-date';

interface TaskComposerPickersProps {
  orgId: string;
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
  cycleNoun: string;
  startDate: string | null;
  dueDate: string | null;
  labelIds: readonly string[];
  labelOptions: readonly PickerOption[];
  /** The workspace's configured estimation scale, or `null` while it loads. */
  estimationScale: EstimationScale | null;
  estimate: number | null;
  creating: boolean;
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
  orgId,
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
  cycleNoun,
  startDate,
  dueDate,
  labelIds,
  labelOptions,
  estimationScale,
  estimate,
  creating,
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

  return (
    <>
      {statusOptions.length > 0 ? (
        <EntityMetadataItem priority={0}>
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
        </EntityMetadataItem>
      ) : null}
      <EntityMetadataItem priority={1}>
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
      </EntityMetadataItem>
      <PersonMetadataPicker
        priority={2}
        field="Assignee"
        orgId={orgId}
        options={actorOptions}
        value={assigneeId}
        onChange={onAssigneeChange}
        disabled={creating}
      />
      <EntityMetadataItem priority={3}>
        <EntityPicker
          options={projectOptions}
          value={projectId}
          onChange={onProjectChange}
          placeholder={`No ${projectNounLower}`}
          triggerIcon={<FolderKanban className="text-on-surface-variant size-4" />}
          clearLabel={`No ${projectNounLower}`}
          searchPlaceholder={`Search ${projectNounLower}s…`}
          ariaLabel={projectNoun}
          disabled={creating}
        />
      </EntityMetadataItem>
      <EntityMetadataItem priority={4}>
        <EntityPicker
          options={milestoneOptionsForProject}
          value={milestoneId}
          onChange={onMilestoneChange}
          placeholder={projectId ? 'No milestone' : `Set a ${projectNounLower} first`}
          triggerIcon={<Flag className="text-on-surface-variant size-4" />}
          clearLabel="No milestone"
          searchPlaceholder="Search milestones…"
          emptyText={
            projectId ? 'No milestones' : `Set a ${projectNounLower} to choose a milestone`
          }
          ariaLabel="Milestone"
          disabled={creating || !projectId}
        />
      </EntityMetadataItem>
      {teamId ? (
        <EntityMetadataItem priority={5}>
          <FutureCyclePicker
            orgId={orgId}
            teamId={teamId}
            value={cycleId}
            onChange={onCycleChange}
            noun={cycleNoun}
            disabled={creating}
            triggerVariant="secondary"
          />
        </EntityMetadataItem>
      ) : null}
      <EntityMetadataItem priority={6}>
        <DatePicker
          value={startDate}
          onChange={onStartDateChange}
          placeholder="No start date"
          formatLabel={triggerDate}
          ariaLabel="Anticipated start"
          disabled={creating}
        />
      </EntityMetadataItem>
      <EntityMetadataItem priority={7}>
        <DatePicker
          value={dueDate}
          onChange={onDueDateChange}
          placeholder="No due date"
          formatLabel={triggerDate}
          ariaLabel="Due date"
          disabled={creating}
        />
      </EntityMetadataItem>
      <EntityMetadataItem priority={7}>
        <LabelsPicker
          options={labelOptions}
          value={labelIds}
          onToggle={onLabelToggle}
          placeholder="No labels"
          ariaLabel="Labels"
          disabled={creating}
        />
      </EntityMetadataItem>
      {estimationScale && estimationScale !== 'none' ? (
        <EntityMetadataItem priority={7}>
          <EstimatePicker
            scale={estimationScale}
            value={estimate}
            onChange={onEstimateChange}
            placeholder="No estimate"
            disabled={creating}
          />
        </EntityMetadataItem>
      ) : null}
    </>
  );
}
