'use client';

/**
 * `EditableSubtitle` — a plain single-line summary that autosaves on a debounce.
 *
 * @remarks
 * The masthead subtitle (project/initiative/program summary) is one line of plain text, not a
 * document — it has no business pulling in {@link EditableFreeformText}'s Markdown editor, whose
 * reserved editor height is what was blowing out the space between the subtitle and the property
 * row below it. This is `EditableTitle`'s always-editable-input + debounced-autosave pattern
 * without the "titles can't be empty" constraint: a cleared subtitle saves as `null`. The
 * non-editable and empty-draft states both truncate to a single line so a long summary never
 * pushes the layout below it around.
 */
import { cn } from '@docket/ui/lib/utils';
import { type JSX, useEffect, useRef, useState } from 'react';

import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';

/** Props for {@link EditableSubtitle}. */
export interface EditableSubtitleProps {
  /** The persisted summary, or null/undefined when none has been written yet. */
  value: string | null | undefined;
  /** Persist a trimmed, changed summary, or `null` when the draft is cleared. */
  onSave: (next: string | null) => void;
  /** Whether the viewer may edit; false renders plain, non-interactive (and still one-line) text. */
  canEdit: boolean;
  /** Accessible label for the edit field, e.g. `"Project summary"`. */
  ariaLabel: string;
  /** Type-scale + color classes applied to BOTH the text and the input so they look identical. */
  className?: string;
  /** Quiet text shown when there's no summary yet (only when editable). */
  placeholder?: string;
}

/** A one-line summary that edits in place and never reserves multi-line editor height. */
export function EditableSubtitle({
  value,
  onSave,
  canEdit,
  ariaLabel,
  className,
  placeholder = 'Add a summary…',
}: EditableSubtitleProps): JSX.Element {
  const baseline = value ?? '';
  const [draft, setDraft] = useState(baseline);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastSaved = useRef(baseline);

  useEffect(() => {
    if (!focused) setDraft(baseline);
    lastSaved.current = baseline;
  }, [baseline, focused]);

  const commit = (next: string): void => {
    const trimmed = next.trim();
    if (trimmed !== lastSaved.current) {
      lastSaved.current = trimmed;
      onSave(trimmed.length > 0 ? trimmed : null);
    }
  };

  useDebouncedAutosave({
    value: draft,
    baseline,
    save: commit,
  });

  if (!canEdit) {
    return (
      <span className={cn('block truncate', className)}>{baseline.length > 0 ? baseline : ''}</span>
    );
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
        commit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit(draft);
          inputRef.current?.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          setDraft(baseline);
          inputRef.current?.blur();
        }
      }}
      className={cn(
        'm-0 w-full min-w-0 truncate border-0 bg-transparent p-0 outline-none',
        className,
      )}
    />
  );
}
