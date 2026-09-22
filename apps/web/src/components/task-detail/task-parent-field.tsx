'use client';

/**
 * The task this one is filed under, chosen from a task search.
 *
 * @remarks
 * Shared by the properties sidebar (a row) and the masthead's chip row (an overflow chip). The
 * search never offers the task itself or its direct subtasks; a deeper loop is refused by the
 * server, whose classified notice says so. Clearing the parent moves the task to the top level,
 * and the move offers Undo like every other hierarchy change.
 */
import { PropertyTrigger } from '@docket/ui/components';
import { Workflow } from '@docket/ui/icons';
import type { QueryKey } from '@tanstack/react-query';
import { type JSX, useMemo } from 'react';

import { useApiQuery } from '@/lib/query';
import { taskDetailDef } from '@/lib/use-task-detail';
import { useTaskRelations } from '@/lib/use-task-relations';

import type { TaskPropertyModel } from './task-masthead-properties';
import { useTaskRelationCommand } from './task-relation-commands';
import { TaskSearchPopover } from './task-search-popover';

/** Props for {@link TaskParentField}. */
export interface TaskParentFieldProps {
  readonly orgId: string;
  readonly model: TaskPropertyModel;
  /** The task's detail cache key, patched when the parent changes. */
  readonly detailKey: QueryKey;
  readonly triggerClassName: string;
}

/**
 * Render the parent picker.
 *
 * @param props - See {@link TaskParentFieldProps}.
 * @returns the trigger, wrapped in its search when the viewer can edit.
 */
export function TaskParentField({
  orgId,
  model,
  detailKey,
  triggerClassName,
}: TaskParentFieldProps): JSX.Element {
  const { task, canEdit } = model;
  const parentTaskId = task.parentTaskId ?? null;
  const parent = useApiQuery({
    ...taskDetailDef(orgId, parentTaskId ?? ''),
    enabled: parentTaskId !== null,
  });
  const relations = useTaskRelations(orgId, task.id, detailKey);
  const [open, setOpen] = useTaskRelationCommand('parent');
  const exclude = useMemo(
    () => new Set([task.id, ...task.subtasks.map((subtask) => subtask.id)]),
    [task.id, task.subtasks],
  );
  const label = parentTaskId === null ? undefined : (parent.data?.title ?? 'Parent task');
  const trigger = (
    <PropertyTrigger
      icon={<Workflow className="text-on-surface-variant size-4" />}
      label={label}
      placeholder="Set parent"
      ariaLabel={`Parent — ${label ?? 'not set'}`}
      readOnly={!canEdit}
      variant="ghost"
      className={triggerClassName}
    />
  );
  if (!canEdit) return trigger;
  return (
    <TaskSearchPopover
      orgId={orgId}
      open={open}
      onOpenChange={setOpen}
      anchor="trigger"
      exclude={exclude}
      onPick={(picked) => {
        relations.setParent(picked.id);
      }}
      searchPlaceholder="File this task under…"
      ariaLabel="Parent task"
      clear={
        parentTaskId === null
          ? undefined
          : {
              label: 'No parent',
              onClear: () => {
                relations.setParent(null);
              },
            }
      }
    >
      {trigger}
    </TaskSearchPopover>
  );
}
