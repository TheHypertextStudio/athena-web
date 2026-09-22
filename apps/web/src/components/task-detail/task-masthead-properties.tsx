'use client';

/**
 * The task's lead properties — status, priority, assignee, project, due date — as fields shared by
 * the masthead's chip row and the properties sidebar.
 *
 * @remarks
 * Each property appears exactly once on screen. While the page docks its sidebar, every property
 * is a sidebar row and {@link TaskMetadataRow} renders nothing. On a narrower pane the sidebar is
 * gone and the row carries every property as chips: the lead set at priorities 0 to 3, so it is the
 * last thing the row gives up, and the rest through {@link TaskSecondaryProperties} at 4 and up.
 */
import type { Priority } from '@docket/work/task-contract';
import type { TaskDetail } from '@docket/work/task-model';
import type { WorkflowState } from '@docket/work/workflow';
import { SourceAwareActorPicker } from '@/components/people/source-person-references';
import { DatePicker, EntityPicker, type PickerOption } from '@docket/ui/components';
import { FolderKanban } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import type { QueryKey } from '@tanstack/react-query';
import type { JSX } from 'react';

import { useCategoryOf } from '@/components/entity-display/use-work-status';
import {
  ENTITY_METADATA_CHIP_CLASS,
  EntityMetadataItem,
  EntityMetadataRow,
  useEntityDetailAside,
} from '@/components/views/entity-detail-layout';
import { formatCalendarDate, isoDateOf } from '@/lib/format-date';
import type { TaskPatch } from '@/lib/use-task-mutations';

import { PriorityPicker } from './PriorityPicker';
import { StatusPicker } from './StatusPicker';
import { TaskParentField } from './task-parent-field';
import { TaskSecondaryProperties, type TaskSecondaryModel } from './task-secondary-properties';

/** The geometry a status or priority menu trigger needs to sit beside the other chips. */
const MENU_CHIP_CLASS = cn(
  ENTITY_METADATA_CHIP_CLASS,
  'text-body-medium h-auto max-w-full justify-start px-2 py-1.5',
);

/** Everything the task's property pickers read, resolved once by the page. */
export interface TaskPropertyModel {
  readonly task: TaskDetail;
  readonly canEdit: boolean;
  /** The task's workflow, or `null` while it loads. */
  readonly workflowStates: readonly WorkflowState[] | null;
  readonly statusPending: boolean;
  readonly priorityPending: boolean;
  readonly onSetState: (stateKey: string) => void;
  readonly onSetPriority: (priority: Priority) => void;
  readonly onPatch: (patch: TaskPatch) => void;
  readonly memberOptions: readonly PickerOption[];
  readonly membersLoading: boolean;
  readonly onMembersOpenChange: (open: boolean) => void;
  readonly projectLabel: string;
  readonly projectOptions: readonly PickerOption[];
  readonly projectLoading: boolean;
  readonly onProjectOpenChange: (open: boolean) => void;
  /** Every property the lead set does not carry. */
  readonly secondary: TaskSecondaryModel;
}

/** What one lead field renders from: the model plus the trigger class its presentation wants. */
export interface LeadFieldProps {
  readonly model: TaskPropertyModel;
  readonly triggerClassName: string;
}

/** The task's workflow state. */
export function StatusField({ model, triggerClassName }: LeadFieldProps): JSX.Element {
  const categoryOf = useCategoryOf('task');
  return (
    <StatusPicker
      current={model.task.state}
      states={model.workflowStates}
      currentType={categoryOf(model.task.state)}
      onSelect={model.onSetState}
      pending={model.statusPending}
      disabled={!model.canEdit}
      triggerVariant="ghost"
      triggerClassName={triggerClassName}
    />
  );
}

/** The task's priority. */
export function PriorityField({ model, triggerClassName }: LeadFieldProps): JSX.Element {
  return (
    <PriorityPicker
      current={model.task.priority}
      onSelect={model.onSetPriority}
      pending={model.priorityPending}
      disabled={!model.canEdit}
      triggerVariant="ghost"
      triggerClassName={triggerClassName}
    />
  );
}

/** Who the task is assigned to. */
export function AssigneeField({ model, triggerClassName }: LeadFieldProps): JSX.Element {
  return (
    <SourceAwareActorPicker
      entity={model.task}
      field="assignee"
      options={model.memberOptions}
      value={model.task.assigneeId ?? null}
      onChange={(assigneeId) => {
        model.onPatch({ assigneeId });
      }}
      placeholder="Assign"
      clearLabel="Unassigned"
      ariaLabel="Assignee"
      readOnly={!model.canEdit}
      loading={model.membersLoading}
      onOpenChange={model.onMembersOpenChange}
      triggerClassName={triggerClassName}
    />
  );
}

/** The task's project, under the workspace's own noun for one. */
export function ProjectField({ model, triggerClassName }: LeadFieldProps): JSX.Element {
  const noun = model.projectLabel.toLowerCase();
  return (
    <EntityPicker
      options={model.projectOptions}
      value={model.task.projectId ?? null}
      onChange={(projectId) => {
        model.onPatch({ projectId });
      }}
      placeholder={`Set ${noun}`}
      triggerIcon={<FolderKanban className="text-on-surface-variant size-4" />}
      clearLabel={`No ${noun}`}
      searchPlaceholder={`Search ${noun}s…`}
      ariaLabel={model.projectLabel}
      readOnly={!model.canEdit}
      loading={model.projectLoading}
      onOpenChange={model.onProjectOpenChange}
      triggerClassName={triggerClassName}
    />
  );
}

/** When the task is due. */
export function DueField({ model, triggerClassName }: LeadFieldProps): JSX.Element {
  return (
    <DatePicker
      value={isoDateOf(model.task.dueDate)}
      onChange={(dueDate) => {
        model.onPatch({ dueDate });
      }}
      placeholder="Set due date"
      formatLabel={(value) => formatCalendarDate(value) ?? undefined}
      ariaLabel="Due"
      readOnly={!model.canEdit}
      triggerClassName={triggerClassName}
    />
  );
}

/** Props for {@link TaskMetadataRow}. */
export interface TaskMetadataRowProps {
  readonly orgId: string;
  readonly model: TaskPropertyModel;
  /** The task's detail cache key, patched when the parent changes. */
  readonly detailKey: QueryKey;
}

/**
 * The masthead's labelled property row: every property as a prioritized chip.
 *
 * @remarks
 * Renders nothing while the page docks its sidebar, which then holds every property.
 *
 * @param props - The page's property model.
 * @returns the row, or `null` when the sidebar holds the properties.
 */
export function TaskMetadataRow({
  orgId,
  model,
  detailKey,
}: TaskMetadataRowProps): JSX.Element | null {
  const { docked } = useEntityDetailAside();
  if (docked) return null;
  const chip = { model, triggerClassName: ENTITY_METADATA_CHIP_CLASS };
  const menuChip = { model, triggerClassName: MENU_CHIP_CLASS };
  return (
    <EntityMetadataRow ariaLabel="Task properties">
      <EntityMetadataItem priority={0}>
        <StatusField {...menuChip} />
      </EntityMetadataItem>
      <EntityMetadataItem priority={0}>
        <PriorityField {...menuChip} />
      </EntityMetadataItem>
      <EntityMetadataItem priority={1}>
        <AssigneeField {...chip} />
      </EntityMetadataItem>
      <EntityMetadataItem priority={2}>
        <ProjectField {...chip} />
      </EntityMetadataItem>
      <EntityMetadataItem priority={3}>
        <DueField {...chip} />
      </EntityMetadataItem>
      <TaskSecondaryProperties model={model} />
      <EntityMetadataItem priority={7} overflowOnly>
        <TaskParentField {...chip} orgId={orgId} detailKey={detailKey} />
      </EntityMetadataItem>
    </EntityMetadataRow>
  );
}
