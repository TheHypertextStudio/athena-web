'use client';

/**
 * `QuickAddTaskRow` — an inline "type a title, press Enter" task composer.
 *
 * @remarks
 * Generalizes the one true inline add in the app ({@link "@/components/task-detail/Subtasks"}) so any
 * task context (a project's Tasks tab, a board column, a cycle) can create work without a modal or a
 * redirect. The host owns the actual create call via {@link QuickAddTaskRowProps.onAdd} — it supplies
 * the contextual defaults (team, project, milestone…) around the typed title. Renders nothing when
 * the viewer can't create.
 *
 * The composer is built for someone entering several tasks in a row, which is the whole reason it
 * exists rather than a dialog. It used to disable the field and wait for the round trip before
 * clearing — so between every two tasks there was a dead input, focus had moved off it, and the
 * next Enter went nowhere. Now each submission captures its own title, the field clears and stays
 * focused in the same turn, and the next one can be typed while the previous is still in flight.
 *
 * Clearing before the server has agreed is only safe if a refusal gives the words back. It does,
 * but not by refilling the field: the field belongs to the next task, and there can be more than
 * one refusal outstanding. Each refused submission becomes its own retryable row, so entering two
 * titles that both fail leaves both of them on screen — putting them back one at a time into a
 * single box means the second one silently overwrites nothing and is simply lost.
 */
import { Plus, RefreshCw, X } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import { type JSX, useRef, useState } from 'react';

import { userErrorMessage } from '@/lib/problem';

/** Props for {@link QuickAddTaskRow}. */
export interface QuickAddTaskRowProps {
  /** Create a task from the typed title; resolves once persisted. */
  onAdd: (title: string) => Promise<void>;
  /** Whether the viewer may create; false renders nothing. */
  canEdit: boolean;
  /** Placeholder prompt, e.g. `"Add a task…"`. */
  placeholder?: string;
}

/** A submission the server refused, kept so its words are not lost. */
interface RefusedSubmission {
  /** Identity for the row, so two refusals of the same text stay distinct. */
  readonly key: number;
  /** Exactly what was typed. */
  readonly title: string;
  /** Application-owned copy for why it did not land. */
  readonly message: string;
}

/** An inline task composer that stays put across entries. */
export function QuickAddTaskRow({
  onAdd,
  canEdit,
  placeholder = 'Add a task…',
}: QuickAddTaskRowProps): JSX.Element | null {
  const [title, setTitle] = useState('');
  const [refused, setRefused] = useState<readonly RefusedSubmission[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);

  if (!canEdit) return null;

  /** Submit one captured title, parking it as retryable if the server refuses. */
  const submit = (submitted: string): void => {
    void onAdd(submitted).catch((caught: unknown) => {
      const message = userErrorMessage(caught, 'Could not add that task.');
      setRefused((current) => [...current, { key: nextKey.current++, title: submitted, message }]);
    });
  };

  const add = (): void => {
    const submitted = title.trim();
    if (submitted.length === 0) return;

    // Cleared and refocused in this turn, before anything is awaited. Whatever the network does
    // next concerns the title captured above, not the field, which now belongs to the next task.
    setTitle('');
    inputRef.current?.focus();
    submit(submitted);
  };

  /** Try a refused submission again, removing its row first so a second failure re-adds it. */
  const retry = (entry: RefusedSubmission): void => {
    setRefused((current) => current.filter((item) => item.key !== entry.key));
    submit(entry.title);
  };

  return (
    <div className="flex flex-col gap-1">
      <form
        className="border-outline-variant focus-within:border-primary flex items-center gap-2 rounded-lg border border-dashed px-3 transition-colors"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <Plus aria-hidden className="text-on-surface-variant size-4 shrink-0" />
        <input
          ref={inputRef}
          value={title}
          aria-label="New task title"
          placeholder={placeholder}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
          onKeyDown={(event) => {
            // Explicit Enter handling (not just implicit form submit) so a single keystroke always adds.
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
          className="text-body-medium text-on-surface placeholder:text-on-surface-variant h-11 flex-1 bg-transparent outline-none"
        />
      </form>

      {refused.length === 0 ? null : (
        <ul aria-label="Tasks that could not be added" className="flex flex-col gap-1">
          {refused.map((entry) => (
            <li
              key={entry.key}
              className="border-error/40 flex items-center gap-2 rounded-lg border border-dashed px-3 py-2"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span data-refused-title className="text-on-surface text-body-medium truncate">
                  {entry.title}
                </span>
                <span role="alert" className="text-error text-body-small">
                  {entry.message}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Retry adding ${entry.title}`}
                onClick={() => {
                  retry(entry);
                }}
              >
                <RefreshCw aria-hidden className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Discard ${entry.title}`}
                onClick={() => {
                  setRefused((current) => current.filter((item) => item.key !== entry.key));
                }}
              >
                <X aria-hidden className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
