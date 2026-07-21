'use client';

/**
 * `QuickAddTaskRow` — an inline "type a title, press Enter" task composer.
 *
 * @remarks
 * Generalizes the one true inline add in the app ({@link "@/components/task-detail/Subtasks"}) so any
 * task context (a project's Tasks tab, a board column, a cycle) can create work without a modal or a
 * redirect. The input never unmounts, so after a create it clears and keeps focus, ready for the next
 * one. The host owns the actual create call via {@link QuickAddTaskRowProps.onAdd} — it supplies the
 * contextual defaults (team, project, milestone…) around the typed title. Renders nothing when the
 * viewer can't create.
 */
import { Plus } from '@docket/ui/icons';
import { type JSX, useState } from 'react';

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
  const [adding, setAdding] = useState(false);

  if (!canEdit) return null;

  const add = async (): Promise<void> => {
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    setAdding(true);
    try {
      await onAdd(trimmed);
      // Clear but keep the field focused (it never unmounts) so the next task flows straight in.
      setTitle('');
    } finally {
      setAdding(false);
    }
  };

  return (
    <form
      className="border-outline-variant focus-within:border-primary flex items-center gap-2 rounded-lg border border-dashed px-3 transition-colors"
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <Plus aria-hidden className="text-on-surface-variant size-4 shrink-0" />
      <input
        value={title}
        disabled={adding}
        aria-label="New task title"
        placeholder={placeholder}
        onChange={(event) => {
          setTitle(event.target.value);
        }}
        onKeyDown={(event) => {
          // Explicit Enter handling (not just implicit form submit) so a single keystroke always adds.
          if (event.key === 'Enter') {
            event.preventDefault();
            void add();
          }
        }}
        className="text-body-medium text-on-surface placeholder:text-on-surface-variant h-11 flex-1 bg-transparent outline-none"
      />
    </form>
  );
}
