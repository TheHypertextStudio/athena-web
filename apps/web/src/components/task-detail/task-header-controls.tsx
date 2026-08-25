'use client';

import type { Priority } from '@docket/work/task-contract';
import type { PickerOption } from '@docket/ui/components';
import { Ellipsis, Trash2 } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  menuDestructiveItem,
} from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';

import { TaskTimerMenuItem } from '../time-tracking/task-timer-button';
import { PriorityGlyph } from './PriorityGlyph';
import { PRIORITY_LABEL, PRIORITY_ORDER } from './priority';

/** Slots rendered by the responsive task-header control row. */
export interface TaskHeaderControlsProps {
  readonly status: ReactNode;
  readonly priority: ReactNode;
  readonly assignee: ReactNode;
  readonly delegate?: ReactNode | undefined;
  readonly actions: ReactNode;
  readonly overflow: ReactNode;
}

/**
 * Keep task metadata and actions on one line while lower-priority slots collapse by container.
 */
export function TaskHeaderControls({
  status,
  priority,
  assignee,
  delegate,
  actions,
  overflow,
}: TaskHeaderControlsProps): JSX.Element {
  return (
    <div className="@container/task-header flex min-w-0 flex-nowrap items-center gap-2">
      <span className="shrink-0">{status}</span>
      <span className="hidden min-w-0 items-center gap-2 @md/task-header:flex">
        {priority}
        {assignee}
      </span>
      <span className="min-w-0 flex-1" aria-hidden="true" />
      <span className="hidden min-w-0 items-center gap-2 @3xl/task-header:flex">
        {delegate}
        {actions}
      </span>
      <span className="shrink-0">{overflow}</span>
    </div>
  );
}

/** Data and mutation callbacks required by the task-header overflow menu. */
export interface TaskHeaderOverflowMenuProps {
  readonly taskId: string;
  readonly title: string;
  readonly priority: Priority;
  readonly priorityPending: boolean;
  readonly memberOptions: readonly PickerOption[];
  readonly assigneeId: string | null;
  readonly canEdit: boolean;
  readonly canManage: boolean;
  /** Start the member read only after the collapsed assignee picker opens. */
  readonly onAssigneeOpenChange?: ((open: boolean) => void) | undefined;
  readonly onPriorityChange: (priority: Priority) => void;
  readonly onAssigneeChange: (assigneeId: string | null) => void;
  readonly onDelete: () => void;
}

const UNASSIGNED_VALUE = '__unassigned__';

/** Preserve every collapsed task action behind an always-available ellipsis. */
export function TaskHeaderOverflowMenu({
  taskId,
  title,
  priority,
  priorityPending,
  memberOptions,
  assigneeId,
  canEdit,
  canManage,
  onAssigneeOpenChange,
  onPriorityChange,
  onAssigneeChange,
  onDelete,
}: TaskHeaderOverflowMenuProps): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Task actions">
          <Ellipsis className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width="md">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!canEdit || priorityPending}>
            <span aria-hidden="true">
              <PriorityGlyph priority={priority} />
            </span>
            Priority
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={priority}
              onValueChange={(value) => {
                if (value !== priority) onPriorityChange(value as Priority);
              }}
            >
              {PRIORITY_ORDER.map((option) => (
                <DropdownMenuRadioItem key={option} value={option}>
                  <span aria-hidden="true">
                    <PriorityGlyph priority={option} />
                  </span>
                  {PRIORITY_LABEL[option]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub {...(onAssigneeOpenChange ? { onOpenChange: onAssigneeOpenChange } : {})}>
          <DropdownMenuSubTrigger disabled={!canEdit}>Assignee</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={assigneeId ?? UNASSIGNED_VALUE}
              onValueChange={(value) => {
                const nextAssigneeId = value === UNASSIGNED_VALUE ? null : value;
                if (nextAssigneeId !== assigneeId) onAssigneeChange(nextAssigneeId);
              }}
            >
              <DropdownMenuRadioItem value={UNASSIGNED_VALUE}>Unassigned</DropdownMenuRadioItem>
              {memberOptions.map((option) => (
                <DropdownMenuRadioItem
                  key={option.value}
                  value={option.value}
                  {...(option.disabled !== undefined ? { disabled: option.disabled } : {})}
                >
                  {option.icon}
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />
        <TaskTimerMenuItem taskId={taskId} title={title} />

        {canManage ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className={menuDestructiveItem()} onSelect={onDelete}>
              <Trash2 className="h-4 w-4" />
              Delete task
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
