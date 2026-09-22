'use client';

/**
 * One linked task in a task page section: a subtask, a blocker, a blocked task, or a related task.
 *
 * @remarks
 * One segment of a `SegmentedList`. The whole row is one link to the task (a stretched link, so it
 * is reachable by keyboard and opens in a new tab like any link). The controls that sit on it — a
 * leading status toggle, a double-click rename of the title, and the trailing remove button — are
 * raised above that link, so no control is nested inside another. The remove button shows on hover
 * and focus, and stays visible on touch screens, which have no hover.
 */
import type { TaskRef } from '@docket/work/task-model';
import { StatusIcon } from '@docket/ui/components';
import { X } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button, focusRing } from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';

import type { RelationDropTargetProps } from '@/components/dnd/use-relation-drop-target';
import Link from '@/components/docket-link';
import { SegmentedListItem } from '@/components/entity-detail/segmented-list';
import { EditableTitle } from '@/components/editor/editable-title';
import { useCategoryOf } from '@/components/entity-display/use-work-status';
import { useAppRouter } from '@/lib/interactions/navigation';

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
  /** Rename the task on double-click. Omit for a read-only title. */
  readonly onRename?: ((taskId: string, title: string) => void) | undefined;
  /** Remove the link (never the task), named for the button (e.g. "Remove blocker"). */
  readonly remove?: { readonly label: string; readonly onRemove: () => void } | undefined;
  /** Make the row a drop destination for another task. */
  readonly drop?: RelationDropTargetProps | undefined;
}

/**
 * Render one linked task.
 *
 * @param props - See {@link TaskRelationRowProps}.
 * @returns the row, a segment for a `SegmentedList`.
 */
export function TaskRelationRow({
  orgId,
  task,
  leading,
  hint,
  done = false,
  onRename,
  remove,
  drop,
}: TaskRelationRowProps): JSX.Element {
  const categoryOf = useCategoryOf('task');
  const router = useAppRouter();
  const href = `/orgs/${orgId}/tasks/${task.id}`;
  const titleClass = cn(
    'text-body-medium min-w-0 truncate',
    done ? 'text-on-surface-variant line-through' : 'text-on-surface',
  );
  return (
    <SegmentedListItem drop={drop}>
      <Link
        href={href}
        aria-label={task.title}
        className={cn(focusRing, 'absolute inset-0 rounded-[inherit]')}
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
                router.push(href);
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
      {remove ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={`${remove.label}: ${task.title}`}
          onClick={remove.onRemove}
          className="coarse:opacity-100 relative -mr-1.5 opacity-0 group-focus-within/segment:opacity-100 group-hover/segment:opacity-100"
        >
          <X className="size-4" />
        </Button>
      ) : null}
    </SegmentedListItem>
  );
}
