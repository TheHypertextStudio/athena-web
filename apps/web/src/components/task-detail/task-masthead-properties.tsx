'use client';

/**
 * The task's property chips, laid into the masthead's {@link EntityMetadataRow}.
 *
 * @remarks
 * The lead set (status, priority, assignee, project, due date) carries priorities 0 to 3, so it is
 * the last thing the row gives up as the pane narrows. The secondary set follows at priorities 4
 * and up, through {@link TaskSecondaryProperties}, unless the page docks those properties beside
 * the body, in which case they are the aside's and this row leads with the primary set alone.
 */
import type { Priority } from '@docket/work/task-contract';
import type { TaskDetail } from '@docket/work/task-model';
import type { WorkflowState } from '@docket/work/workflow';
import { ActorPicker, DatePicker, EntityPicker, type PickerOption } from '@docket/ui/components';
import { FolderKanban } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import type { JSX } from 'react';

import { useCategoryOf } from '@/components/entity-display/use-work-status';
import {
  ENTITY_METADATA_CHIP_CLASS,
  EntityMetadataItem,
  EntityMetadataRow,
  useEntityDetailAside,
} from '@/components/views/entity-detail-layout';
import { formatCalendarDate } from '@/lib/format-date';
import type { TaskPatch } from '@/lib/use-task-mutations';

import { PriorityPicker } from './PriorityPicker';
import { StatusPicker } from './StatusPicker';
import {
  TaskSecondaryProperties,
  type TaskSecondaryPropertiesProps,
} from './task-secondary-properties';

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
  readonly secondary: Omit<TaskSecondaryPropertiesProps, 'presentation'>;
}

/** The masthead's labelled property row, holding the chips for `model`. */
export function TaskMetadataRow({ model }: { readonly model: TaskPropertyModel }): JSX.Element {
  return (
    <EntityMetadataRow ariaLabel="Task properties">
      <TaskMastheadProperties model={model} />
    </EntityMetadataRow>
  );
}

/** Props for {@link TaskMastheadProperties}. */
export interface TaskMastheadPropertiesProps {
  readonly model: TaskPropertyModel;
}

/** A calendar day from a stored date or timestamp, in the `YYYY-MM-DD` the date field exchanges. */
function isoDateOf(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

/** The task's project, under the workspace's own noun for one. */
function ProjectPicker({ model }: { readonly model: TaskPropertyModel }): JSX.Element {
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
      triggerClassName={ENTITY_METADATA_CHIP_CLASS}
    />
  );
}

/**
 * Render the task's properties as prioritized metadata chips.
 *
 * @remarks
 * While the layout has docked its aside, the secondary set lives there, so this row leads with the
 * five lead properties alone and no property is mounted twice.
 *
 * @param props - See {@link TaskMastheadPropertiesProps}.
 * @returns the chips, to be placed inside an `EntityMetadataRow`.
 */
export function TaskMastheadProperties({ model }: TaskMastheadPropertiesProps): JSX.Element {
  const { task, canEdit, onPatch } = model;
  const { docked } = useEntityDetailAside();
  const categoryOf = useCategoryOf('task');
  return (
    <>
      <EntityMetadataItem priority={0}>
        <StatusPicker
          current={task.state}
          states={model.workflowStates}
          currentType={categoryOf(task.state)}
          onSelect={model.onSetState}
          pending={model.statusPending}
          disabled={!canEdit}
          triggerVariant="ghost"
          triggerClassName={MENU_CHIP_CLASS}
        />
      </EntityMetadataItem>
      <EntityMetadataItem priority={0}>
        <PriorityPicker
          current={task.priority}
          onSelect={model.onSetPriority}
          pending={model.priorityPending}
          disabled={!canEdit}
          triggerVariant="ghost"
          triggerClassName={MENU_CHIP_CLASS}
        />
      </EntityMetadataItem>
      <EntityMetadataItem priority={1}>
        <ActorPicker
          options={model.memberOptions}
          value={task.assigneeId ?? null}
          onChange={(assigneeId) => {
            onPatch({ assigneeId });
          }}
          placeholder="Assign"
          clearLabel="Unassigned"
          ariaLabel="Assignee"
          readOnly={!canEdit}
          loading={model.membersLoading}
          onOpenChange={model.onMembersOpenChange}
          triggerClassName={ENTITY_METADATA_CHIP_CLASS}
        />
      </EntityMetadataItem>
      <EntityMetadataItem priority={2}>
        <ProjectPicker model={model} />
      </EntityMetadataItem>
      <EntityMetadataItem priority={3}>
        <DatePicker
          value={isoDateOf(task.dueDate)}
          onChange={(dueDate) => {
            onPatch({ dueDate });
          }}
          placeholder="Set due date"
          formatLabel={(value) => formatCalendarDate(value) ?? undefined}
          ariaLabel="Due"
          readOnly={!canEdit}
          triggerClassName={ENTITY_METADATA_CHIP_CLASS}
        />
      </EntityMetadataItem>
      {docked ? null : <TaskSecondaryProperties presentation="chips" {...model.secondary} />}
    </>
  );
}
