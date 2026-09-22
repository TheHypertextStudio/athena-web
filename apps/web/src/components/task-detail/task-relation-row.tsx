'use client';

/**
 * One related task in a task page section: a subtask, a blocker, a blocked task, or a related task.
 *
 * @remarks
 * A 36px list row. The whole row is one link to the task (a stretched link, so it is reachable by
 * keyboard and opens in a new tab like any link). The controls that sit on it — a leading status
 * toggle, a double-click rename of the title, and the trailing remove button — are raised above
 * that link, so no control is nested inside another. The remove button shows on hover and focus,
 * and stays visible on touch screens, which have no hover.
 */
import type { TaskRef } from '@docket/work/task-model';
import { StatusIcon } from '@docket/ui/components';
import { X } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button } from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';

import type { RelationDropTargetProps } from '@/components/dnd/use-relation-drop-target';
import Link from '@/components/docket-link';
import { EditableTitle } from '@/components/editor/editable-title';
import { useCategoryOf } from '@/components/entity-display/use-work-status';

/** Props for {@link TaskRelationRow}. */
export interface TaskRelationRowProps {
  readonly orgId: string;
  readonly task: TaskRef;
  /** The leading control; defaults to the task's status glyph. */
  readonly leading?: ReactNode;
  /** A muted trailing hint, such as the task's project when it differs from this task's. */
  readonly hint?: string | null | undefined;
  /** Whether the title reads as finished work. */
  readonly done?: boolean;
  /** Open the task; a single click on the title opens through this. */
  readonly onOpen: (taskId: string) => void;
  /** Rename the task in place on double-click. Omit for a read-only title. */
  readonly onRename?: ((taskId: string, title: string) => void) | undefined;
  /** Remove the relation (never the task). Omit when the viewer cannot edit. */
  readonly onRemove?: (() => void) | undefined;
  /** Accessible name for the remove button (e.g. "Remove blocker"). */
  readonly removeLabel?: string;
  /** A drop target's props for the row, so another task can be dropped onto it. */
  readonly rowProps?: RelationDropTargetProps | undefined;
}

/**
 * Render one related task.
 *
 * @param props - See {@link TaskRelationRowProps}.
 * @returns the `li` row.
 */
export function TaskRelationRow({
  orgId,
  task,
  leading,
  hint,
  done = false,
  onOpen,
  onRename,
  onRemove,
  removeLabel = 'Remove',
  rowProps,
}: TaskRelationRowProps): JSX.Element {
  const categoryOf = useCategoryOf('task');
  const titleClass = cn(
    'text-body-medium min-w-0 truncate',
    done ? 'text-on-surface-variant line-through' : 'text-on-surface',
  );
  return (
    <li
      ref={rowProps?.ref}
      data-drop-state={rowProps?.['data-drop-state']}
      className={cn(
        'group/relation hover:bg-surface-container-high focus-within:bg-surface-container-high relative flex min-h-9 items-center gap-2 rounded-md px-2',
        rowProps?.className,
      )}
    >
      <Link
        href={`/orgs/${orgId}/tasks/${task.id}`}
        aria-label={task.title}
        className="focus-visible:ring-ring absolute inset-0 rounded-md focus-visible:ring-1 focus-visible:outline-none"
      />
      <span className="relative flex shrink-0 items-center">
        {leading ?? <StatusIcon type={categoryOf(task.state)} />}
      </span>
      <span className="pointer-events-none relative flex min-w-0 flex-1">
        {onRename ? (
          <span className="pointer-events-auto flex min-w-0">
            <EditableTitle
              value={task.title}
              onSave={(title) => {
                onRename(task.id, title);
              }}
              canEdit
              activate="doubleClick"
              onActivate={() => {
                onOpen(task.id);
              }}
              ariaLabel="Task title"
              className={titleClass}
            />
          </span>
        ) : (
          <span className={titleClass}>{task.title}</span>
        )}
      </span>
      {hint ? (
        <span className="text-on-surface-variant text-body-small pointer-events-none relative max-w-[40%] shrink-0 truncate">
          {hint}
        </span>
      ) : null}
      {onRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={`${removeLabel}: ${task.title}`}
          onClick={onRemove}
          className="coarse:opacity-100 relative opacity-0 group-focus-within/relation:opacity-100 group-hover/relation:opacity-100"
        >
          <X className="size-4" />
        </Button>
      ) : null}
    </li>
  );
}
