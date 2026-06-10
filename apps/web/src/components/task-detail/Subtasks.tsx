'use client';

import type { TaskRef } from '@docket/types';
import { StatusIcon } from '@docket/ui/components';
import { Plus } from '@docket/ui/icons';
import { Button, Input } from '@docket/ui/primitives';
import { type JSX, useMemo, useState } from 'react';

import { stateTypeOf } from '@/lib/work-state';

/** Props for {@link Subtasks}. */
interface SubtasksProps {
  /** The parent task's subtask refs (carry id/title/state). */
  subtasks: readonly TaskRef[];
  /** Add a subtask by title; resolves when the create round-trip completes. */
  onAdd: (title: string) => Promise<void>;
  /** Toggle a subtask between done and todo by its current completion. */
  onToggle: (subtask: TaskRef, done: boolean) => Promise<void>;
  /** Navigate to a subtask's own detail view. */
  onOpen: (subtaskId: string) => void;
  /** Whether the caller may add subtasks (hides the composer when false). */
  canEdit: boolean;
}

/**
 * The inline subtasks checklist shown under the task description.
 *
 * @remarks
 * Each subtask renders as a toggle row: its {@link StatusIcon} doubles as a checkbox
 * that flips the subtask's workflow state between `done` and `todo` (through the API's
 * `POST /:id/state`), with the title linking to that subtask's own detail. A progress
 * count (`done / total`) heads the list and a composer at the foot adds new subtasks by
 * title. Optimism is owned by the parent screen, which re-reads after each mutation.
 */
export function Subtasks({
  subtasks,
  onAdd,
  onToggle,
  onOpen,
  canEdit,
}: SubtasksProps): JSX.Element {
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const doneCount = useMemo(
    () => subtasks.filter((s) => stateTypeOf(s.state) === 'completed').length,
    [subtasks],
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
    const isDone = stateTypeOf(subtask.state) === 'completed';
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
        <h2 id="subtasks-heading" className="text-body font-medium">
          Subtasks
        </h2>
        {subtasks.length > 0 ? (
          <span className="text-on-surface-variant text-xs tabular-nums">
            {doneCount}/{subtasks.length}
          </span>
        ) : null}
      </div>

      {subtasks.length === 0 ? (
        <p className="text-on-surface-variant text-body">No subtasks yet.</p>
      ) : (
        <ul className="flex flex-col">
          {subtasks.map((subtask) => {
            const type = stateTypeOf(subtask.state);
            const done = type === 'completed';
            return (
              <li
                key={subtask.id}
                className="group hover:bg-surface-container-high -mx-2 flex items-center gap-2 rounded-md px-2 py-1.5"
              >
                <button
                  type="button"
                  aria-label={
                    done ? `Mark “${subtask.title}” as todo` : `Mark “${subtask.title}” as done`
                  }
                  aria-pressed={done}
                  disabled={!canEdit || busyId === subtask.id}
                  onClick={() => {
                    void toggle(subtask);
                  }}
                  className="focus-visible:ring-ring rounded-full focus-visible:ring-1 focus-visible:outline-none disabled:opacity-50"
                >
                  <StatusIcon type={type} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpen(subtask.id);
                  }}
                  className="focus-visible:ring-ring text-body min-w-0 flex-1 truncate rounded text-left hover:underline focus-visible:ring-1 focus-visible:outline-none"
                >
                  <span className={done ? 'text-on-surface-variant line-through' : ''}>
                    {subtask.title}
                  </span>
                </button>
              </li>
            );
          })}
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
