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
import type { JSX } from 'react';

import { useApiQuery } from '@/lib/query';
import { taskDetailDef } from '@/lib/use-task-detail';

import type { LeadFieldProps } from './task-masthead-properties';
import { TaskSearchPopover } from './task-search-popover';

/**
 * Render the parent picker.
 *
 * @param props - The page's property model and the trigger class its presentation wants.
 * @returns the trigger, wrapped in its search when the viewer can edit.
 */
export function TaskParentField({ model, triggerClassName }: LeadFieldProps): JSX.Element {
  const { task, canEdit } = model;
  const parentTaskId = task.parentTaskId ?? null;
  const parent = useApiQuery({
    ...taskDetailDef(task.organizationId, parentTaskId ?? ''),
    enabled: parentTaskId !== null,
  });
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
    <TaskSearchPopover task={task} links={['parent']} anchor="trigger">
      {trigger}
    </TaskSearchPopover>
  );
}
