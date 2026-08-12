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
 * Clearing before the server has agreed is only honest if a refusal gives the words back, so a
 * failed submission returns its title to the field — unless something newer has been typed, in
 * which case it is reported without overwriting what is there.
 */
import { Plus } from '@docket/ui/icons';
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

/** An inline task composer that stays put across entries. */
export function QuickAddTaskRow({
  onAdd,
  canEdit,
  placeholder = 'Add a task…',
}: QuickAddTaskRowProps): JSX.Element | null {
  const [title, setTitle] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!canEdit) return null;

  const add = (): void => {
    const submitted = title.trim();
    if (submitted.length === 0) return;

    // Cleared and refocused in this turn, before anything is awaited. Whatever the network does
    // next concerns the title captured above, not the field, which now belongs to the next task.
    setTitle('');
    setFailure(null);
    inputRef.current?.focus();

    void onAdd(submitted).catch((caught: unknown) => {
      setFailure(userErrorMessage(caught, 'Could not add that task.'));
      // Hand the words back — but only into a field the person has not already claimed for
      // something else. An older failure must never overwrite a newer draft.
      setTitle((current) => (current.length === 0 ? submitted : current));
    });
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
            if (failure !== null) setFailure(null);
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
      {failure === null ? null : (
        <p role="alert" className="text-error text-body-small px-3">
          {failure}
        </p>
      )}
    </div>
  );
}
