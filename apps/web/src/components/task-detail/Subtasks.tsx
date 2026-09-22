'use client';

/**
 * The task's subtasks: a checklist of its direct children, with ways to add, attach, and detach.
 *
 * @remarks
 * The heading row carries the `done/total` count and two actions: `+` opens an inline composer for
 * a new subtask, and the link button attaches a task that already exists. The composer stays open
 * after each subtask so a list can be typed out one line after another; Escape or an empty blur
 * closes it. Each row's status glyph is a checkbox, its title opens the subtask (a double-click
 * renames it), and its remove button moves the subtask back to the top level.
 */
import type { TaskRef } from '@docket/work/task-model';
import { StatusIcon } from '@docket/ui/components';
import { Link as LinkIcon, Plus } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button, Input } from '@docket/ui/primitives';
import { type JSX, useMemo, useState } from 'react';

import { DetailSection } from '@/components/entity-detail/detail-section';
import { useStatusRegistry } from '@/components/statuses/status-registry';
import { useCategoryOf } from '@/components/entity-display/use-work-status';
import { useTaskHierarchyDrop } from '@/components/tasks/task-hierarchy-drop';
import type { ObjectRef } from '@/lib/actions';

import { useTaskRelationCommand } from './task-relation-commands';
import { TaskRelationRow } from './task-relation-row';
import { TaskSearchPopover } from './task-search-popover';

/** Props for {@link Subtasks}. */
export interface SubtasksProps {
  /** Workspace that owns the parent and every subtask. */
  readonly organizationId: string;
  /** Parent task whose children are listed. */
  readonly parentTaskId: string;
  /** The parent's own ancestors and itself, which can never become its subtasks. */
  readonly ineligibleIds: ReadonlySet<string>;
  /** The parent task's subtask refs. */
  readonly subtasks: readonly TaskRef[];
  /** Create a subtask by title; rejects when the create fails. */
  readonly onAdd: (title: string) => Promise<void>;
  /** Make an existing task a subtask of this one. */
  readonly onAttach: (task: TaskRef) => void;
  /** Move a subtask back to the top level. */
  readonly onDetach: (subtaskId: string) => void;
  /** Toggle a subtask between done and its starting state. */
  readonly onToggle: (subtask: TaskRef, done: boolean) => Promise<void>;
  /** Navigate to a subtask's own detail view. */
  readonly onOpen: (subtaskId: string) => void;
  /** Rename a subtask in place. */
  readonly onRename?: ((subtaskId: string, title: string) => void) | undefined;
  /** Whether the viewer may add, attach, detach, toggle, or rename. */
  readonly canEdit: boolean;
}

/**
 * Render the Subtasks section.
 *
 * @param props - See {@link SubtasksProps}.
 * @returns the section.
 */
export function Subtasks(props: SubtasksProps): JSX.Element {
  const { organizationId, subtasks, canEdit } = props;
  const categoryOf = useCategoryOf('task');
  const [composerOpen, onComposerOpenChange] = useTaskRelationCommand('newSubtask');
  const [attachOpen, setAttachOpen] = useTaskRelationCommand('existingSubtask');
  const doneCount = subtasks.filter((s) => categoryOf(s.state) === 'completed').length;
  const exclude = useMemo(
    () => new Set([...props.ineligibleIds, ...subtasks.map((s) => s.id)]),
    [props.ineligibleIds, subtasks],
  );

  const actions = canEdit ? (
    <>
      <TaskSearchPopover
        orgId={organizationId}
        open={attachOpen}
        onOpenChange={setAttachOpen}
        anchor="trigger"
        exclude={exclude}
        onPick={props.onAttach}
        searchPlaceholder="Add an existing task…"
        ariaLabel="Existing task to add as a subtask"
      >
        <Button type="button" variant="ghost" size="sm" iconOnly aria-label="Add existing task">
          <LinkIcon className="size-4" />
        </Button>
      </TaskSearchPopover>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        iconOnly
        aria-label="Add subtask"
        aria-expanded={composerOpen}
        onClick={() => {
          onComposerOpenChange(true);
        }}
      >
        <Plus className="size-4" />
      </Button>
    </>
  ) : null;

  return (
    <DetailSection
      id="subtasks"
      title="Subtasks"
      count={subtasks.length > 0 ? `${doneCount}/${subtasks.length}` : undefined}
      actions={actions}
    >
      {subtasks.length > 0 || composerOpen ? (
        <ul className="flex flex-col">
          {subtasks.map((subtask) => (
            <SubtaskRow key={subtask.id} subtask={subtask} {...props} />
          ))}
          {canEdit && composerOpen ? (
            <SubtaskComposer
              onAdd={props.onAdd}
              onClose={() => {
                onComposerOpenChange(false);
              }}
            />
          ) : null}
        </ul>
      ) : null}
    </DetailSection>
  );
}

/** Props for {@link SubtaskComposer}. */
interface SubtaskComposerProps {
  readonly onAdd: (title: string) => Promise<void>;
  readonly onClose: () => void;
}

/**
 * The inline row that adds subtasks by title.
 *
 * @remarks
 * Enter creates the subtask and clears the field for the next one. A failed create keeps the typed
 * title so nothing is lost; the query layer has already told the person what went wrong.
 */
function SubtaskComposer({ onAdd, onClose }: SubtaskComposerProps): JSX.Element {
  const landing = useStatusRegistry().defaultOf('task')?.category ?? 'backlog';
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);

  async function add(): Promise<void> {
    const trimmed = title.trim();
    if (trimmed.length === 0 || adding) return;
    setAdding(true);
    setTitle('');
    try {
      await onAdd(trimmed);
    } catch {
      setTitle((current) => (current.length === 0 ? trimmed : current));
    } finally {
      setAdding(false);
    }
  }

  return (
    <li className="flex min-h-9 items-center gap-2 px-2">
      <StatusIcon type={landing} />
      <form
        className="flex min-w-0 flex-1"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <Input
          autoFocus
          aria-label="New subtask title"
          placeholder="Subtask title"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
          onBlur={() => {
            if (title.trim().length === 0 && !adding) onClose();
          }}
          className="h-8"
        />
      </form>
    </li>
  );
}

/** Props for {@link SubtaskRow}. */
interface SubtaskRowProps extends SubtasksProps {
  readonly subtask: TaskRef;
}

/** One subtask: a status checkbox, the title, and a detach button. */
function SubtaskRow({
  subtask,
  subtasks,
  organizationId,
  parentTaskId,
  canEdit,
  onToggle,
  onOpen,
  onRename,
  onDetach,
}: SubtaskRowProps): JSX.Element {
  const categoryOf = useCategoryOf('task');
  const [busy, setBusy] = useState(false);
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

  const toggle = (): void => {
    setBusy(true);
    onToggle(subtask, !done)
      .catch(() => undefined)
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <TaskRelationRow
      orgId={organizationId}
      task={subtask}
      done={done}
      onOpen={onOpen}
      onRename={canEdit ? onRename : undefined}
      onRemove={
        canEdit
          ? () => {
              onDetach(subtask.id);
            }
          : undefined
      }
      removeLabel="Remove from subtasks"
      rowProps={{ ...drop.rowProps, className: cn(drop.rowProps.className, drop.className) }}
      leading={
        <>
          <button
            type="button"
            aria-label={
              done ? `Mark “${subtask.title}” as todo` : `Mark “${subtask.title}” as done`
            }
            aria-pressed={done}
            disabled={!canEdit || busy}
            onClick={toggle}
            className="focus-visible:ring-ring rounded-full focus-visible:ring-1 focus-visible:outline-none disabled:opacity-50"
          >
            <StatusIcon type={type} />
          </button>
          {drop.status ? (
            <span className="sr-only" role="status">
              {drop.status}
            </span>
          ) : null}
        </>
      }
    />
  );
}
