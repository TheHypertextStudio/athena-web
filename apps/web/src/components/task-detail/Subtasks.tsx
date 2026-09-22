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
import type { TaskDetail, TaskRef } from '@docket/work/task-model';
import { StatusIcon } from '@docket/ui/components';
import { Link as LinkIcon, Plus } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button, focusRing, Input } from '@docket/ui/primitives';
import { type JSX, useMemo, useState } from 'react';

import { DetailSection } from '@/components/entity-detail/detail-section';
import { SegmentedList, SegmentedListItem } from '@/components/entity-detail/segmented-list';
import { useCategoryOf } from '@/components/entity-display/use-work-status';
import { useStatusRegistry } from '@/components/statuses/status-registry';
import { useTaskHierarchyDrop } from '@/components/tasks/task-hierarchy-drop';
import type { TaskHierarchyItem } from '@/components/tasks/task-hierarchy-model';
import { taskObjectRef } from '@/lib/actions';
import type { TaskMutations } from '@/lib/use-task-mutations';

import { LINK_COPY, useTaskRelationControls } from './task-relation-commands';
import { TaskRelationRow } from './task-relation-row';
import { TaskSearchPopover } from './task-search-popover';

/** The writes the section makes beyond linking: creating a subtask and ticking one off. */
export type SubtaskMutations = Pick<TaskMutations, 'addSubtask' | 'toggleSubtask'>;

/** Props for {@link Subtasks}. */
export interface SubtasksProps {
  /** The parent task; its subtasks are listed. */
  readonly task: TaskDetail;
  readonly mutations: SubtaskMutations;
  /** Whether the viewer may add, attach, detach, toggle, or rename. */
  readonly canEdit: boolean;
}

/**
 * Render the Subtasks section.
 *
 * @param props - See {@link SubtasksProps}.
 * @returns the section.
 */
export function Subtasks({ task, mutations, canEdit }: SubtasksProps): JSX.Element {
  const categoryOf = useCategoryOf('task');
  const { active, setActive } = useTaskRelationControls();
  const composerOpen = active === 'newSubtask';
  const { subtasks } = task;
  const doneCount = subtasks.filter((s) => categoryOf(s.state) === 'completed').length;
  // A drop onto a row nests the dragged task under that subtask; the drop checks this tree for loops.
  const hierarchy = useMemo<readonly TaskHierarchyItem[]>(
    () => [
      { id: task.id, parentTaskId: null },
      ...subtasks.map(({ id }) => ({ id, parentTaskId: task.id })),
    ],
    [subtasks, task.id],
  );

  const actions = canEdit ? (
    <>
      <TaskSearchPopover task={task} links={['subtask']} anchor="trigger">
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
          setActive('newSubtask');
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
        <SegmentedList>
          {subtasks.map((subtask) => (
            <SubtaskRow
              key={subtask.id}
              parent={task}
              subtask={subtask}
              hierarchy={hierarchy}
              onToggle={mutations.toggleSubtask}
              canEdit={canEdit}
            />
          ))}
          {canEdit && composerOpen ? (
            <SubtaskComposer
              onAdd={mutations.addSubtask}
              onClose={() => {
                setActive(null);
              }}
            />
          ) : null}
        </SegmentedList>
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
 * Enter creates the subtask and clears the field for the next one, without waiting for the server.
 * A failed create puts the typed title back when the field is still empty, so nothing is lost; the
 * query layer has already told the person what went wrong.
 */
function SubtaskComposer({ onAdd, onClose }: SubtaskComposerProps): JSX.Element {
  const landing = useStatusRegistry().defaultOf('task')?.category ?? 'backlog';
  const [title, setTitle] = useState('');

  const add = (): void => {
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    setTitle('');
    onAdd(trimmed).catch(() => {
      setTitle((current) => (current.length === 0 ? trimmed : current));
    });
  };

  return (
    <SegmentedListItem>
      <StatusIcon type={landing} />
      <form
        className="flex min-w-0 flex-1"
        onSubmit={(event) => {
          event.preventDefault();
          add();
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
            if (title.trim().length === 0) onClose();
          }}
          className="h-8"
        />
      </form>
    </SegmentedListItem>
  );
}

/** Props for {@link SubtaskRow}. */
interface SubtaskRowProps {
  readonly parent: TaskDetail;
  readonly subtask: TaskRef;
  /** The parent and its subtasks, for checking a drop onto this row. */
  readonly hierarchy: readonly TaskHierarchyItem[];
  readonly onToggle: SubtaskMutations['toggleSubtask'];
  readonly canEdit: boolean;
}

/** One subtask: a status checkbox, the title, and a detach button. */
function SubtaskRow({
  parent,
  subtask,
  hierarchy,
  onToggle,
  canEdit,
}: SubtaskRowProps): JSX.Element {
  const categoryOf = useCategoryOf('task');
  const { writes } = useTaskRelationControls();
  const [busy, setBusy] = useState(false);
  const drop = useTaskHierarchyDrop(
    taskObjectRef({ ...subtask, parentTaskId: parent.id }, parent.organizationId),
    hierarchy,
  );
  const type = categoryOf(subtask.state);
  const done = type === 'completed';

  const toggle = (): void => {
    setBusy(true);
    onToggle(subtask.id, !done)
      .catch(() => undefined)
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <TaskRelationRow
      orgId={parent.organizationId}
      task={subtask}
      done={done}
      onRename={canEdit ? writes.rename : undefined}
      remove={
        canEdit
          ? {
              label: LINK_COPY.subtask.remove,
              onRemove: () => {
                writes.unlink('subtask', subtask.id);
              },
            }
          : undefined
      }
      drop={{ ...drop.rowProps, className: cn(drop.rowProps.className, drop.className) }}
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
            className={cn(focusRing, 'rounded-full disabled:opacity-50')}
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
