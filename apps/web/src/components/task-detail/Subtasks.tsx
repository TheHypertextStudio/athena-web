'use client';

import type { TaskRef } from '@docket/work/task-model';
import { StatusIcon } from '@docket/ui/components';
import { Plus } from '@docket/ui/icons';
import { Button, Input } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import { type JSX, useMemo, useState } from 'react';

import { EditableTitle } from '@/components/editor/editable-title';
import { useCategoryOf } from '@/components/entity-display/use-work-status';
import { useTaskHierarchyDrop } from '@/components/tasks/task-hierarchy-drop';
import type { ObjectRef } from '@/lib/actions';
import type { CategoryOfState } from '@/lib/work-category';

/** Props for {@link Subtasks}. */
interface SubtasksProps {
  /** Workspace that owns the parent and every subtask. */
  organizationId: string;
  /** Parent task whose children are listed. */
  parentTaskId: string;
  /** The parent task's subtask refs (carry id/title/state). */
  subtasks: readonly TaskRef[];
  /** Add a subtask by title; resolves when the create round-trip completes. */
  onAdd: (title: string) => Promise<void>;
  /** Toggle a subtask between done and todo by its current completion. */
  onToggle: (subtask: TaskRef, done: boolean) => Promise<void>;
  /** Navigate to a subtask's own detail view. */
  onOpen: (subtaskId: string) => void;
  /**
   * Rename a subtask in place. When provided (and {@link SubtasksProps.canEdit}), the title becomes
   * an inline editor: a single click opens the subtask, a double-click renames it. Omitted → the
   * title stays a plain open affordance.
   */
  onRename?: (subtaskId: string, title: string) => void;
  /** Whether the caller may add or rename subtasks (hides the composer / inline rename when false). */
  canEdit: boolean;
}

/**
 * The inline subtasks checklist shown under the task description.
 *
 * @remarks
 * Each subtask renders as a toggle row: its {@link StatusIcon} doubles as a checkbox
 * that moves the subtask between the workspace's completed and starting statuses (through the
 * API's `POST /:id/state`), with the title linking to that subtask's own detail. A progress
 * count (`done / total`) heads the list and a composer at the foot adds new subtasks by
 * title. Optimism is owned by the parent screen, which re-reads after each mutation.
 */
export function Subtasks({
  organizationId,
  parentTaskId,
  subtasks,
  onAdd,
  onToggle,
  onOpen,
  onRename,
  canEdit,
}: SubtasksProps): JSX.Element {
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const categoryOf = useCategoryOf('task');

  const doneCount = useMemo(
    () => subtasks.filter((s) => categoryOf(s.state) === 'completed').length,
    [subtasks, categoryOf],
  );

  async function add(): Promise<void> {
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    setAdding(true);
    try {
      await onAdd(trimmed);
      setTitle('');
    } finally {
      setAdding(false);
    }
  }

  async function toggle(subtask: TaskRef): Promise<void> {
    const isDone = categoryOf(subtask.state) === 'completed';
    setBusyId(subtask.id);
    try {
      await onToggle(subtask, !isDone);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-labelledby="subtasks-heading" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 id="subtasks-heading" className="text-body-medium font-medium">
          Subtasks
        </h2>
        {subtasks.length > 0 ? (
          <span className="text-on-surface-variant text-xs tabular-nums">
            {doneCount}/{subtasks.length}
          </span>
        ) : null}
      </div>

      {subtasks.length === 0 ? (
        <p className="text-on-surface-variant text-body-medium">No subtasks yet.</p>
      ) : (
        <ul className="flex flex-col">
          {subtasks.map((subtask) => (
            <SubtaskRow
              key={subtask.id}
              subtask={subtask}
              subtasks={subtasks}
              organizationId={organizationId}
              parentTaskId={parentTaskId}
              canEdit={canEdit}
              busy={busyId === subtask.id}
              categoryOf={categoryOf}
              onToggle={() => {
                void toggle(subtask);
              }}
              onOpen={() => {
                onOpen(subtask.id);
              }}
              {...(onRename
                ? {
                    onRename: (title: string) => {
                      onRename(subtask.id, title);
                    },
                  }
                : {})}
            />
          ))}
        </ul>
      )}

      {canEdit ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <Input
            aria-label="New subtask title"
            placeholder="Add a subtask…"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            className="h-8"
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={adding || title.trim().length === 0}
            className="gap-1"
          >
            <Plus className="size-4" />
            {adding ? 'Adding…' : 'Add'}
          </Button>
        </form>
      ) : null}
    </section>
  );
}

/** One inline subtask row that can accept another task as its child. */
function SubtaskRow({
  subtask,
  subtasks,
  organizationId,
  parentTaskId,
  canEdit,
  busy,
  categoryOf,
  onToggle,
  onOpen,
  onRename,
}: {
  readonly subtask: TaskRef;
  readonly subtasks: readonly TaskRef[];
  readonly organizationId: string;
  readonly parentTaskId: string;
  readonly canEdit: boolean;
  readonly busy: boolean;
  readonly categoryOf: CategoryOfState;
  readonly onToggle: () => void;
  readonly onOpen: () => void;
  readonly onRename?: (title: string) => void;
}): JSX.Element {
  const object = {
    kind: 'task' as const,
    id: subtask.id,
    organizationId,
    title: subtask.title,
    meta: { parentTaskId },
  } satisfies ObjectRef;
  const hierarchyRows = [
    { id: parentTaskId, parentTaskId: null },
    ...subtasks.map(({ id }) => ({ id, parentTaskId })),
  ];
  const drop = useTaskHierarchyDrop(object, hierarchyRows);
  const type = categoryOf(subtask.state);
  const done = type === 'completed';
  return (
    <li
      {...drop.rowProps}
      className={cn(
        'group hover:bg-surface-container-high -mx-2 flex items-center gap-2 rounded-md px-2 py-1.5',
        drop.rowProps.className,
        drop.className,
      )}
    >
      <button
        type="button"
        aria-label={done ? `Mark “${subtask.title}” as todo` : `Mark “${subtask.title}” as done`}
        aria-pressed={done}
        disabled={!canEdit || busy}
        onClick={onToggle}
        className="focus-visible:ring-ring rounded-full focus-visible:ring-1 focus-visible:outline-none disabled:opacity-50"
      >
        <StatusIcon type={type} />
      </button>
      {canEdit && onRename ? (
        <EditableTitle
          value={subtask.title}
          onSave={(title) => {
            onRename(title);
          }}
          canEdit
          activate="doubleClick"
          onActivate={() => {
            onOpen();
          }}
          ariaLabel="Subtask title"
          className={cn(
            'text-body-medium min-w-0 flex-1 truncate',
            done ? 'text-on-surface-variant line-through' : 'text-on-surface',
          )}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            onOpen();
          }}
          className="focus-visible:ring-ring text-body-medium min-w-0 flex-1 truncate rounded text-left hover:underline focus-visible:ring-1 focus-visible:outline-none"
        >
          <span className={done ? 'text-on-surface-variant line-through' : ''}>
            {subtask.title}
          </span>
        </button>
      )}
      {drop.status ? (
        <span className="sr-only" role="status">
          {drop.status}
        </span>
      ) : null}
    </li>
  );
}
