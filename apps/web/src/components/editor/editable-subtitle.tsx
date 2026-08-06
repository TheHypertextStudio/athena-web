'use client';

/**
 * `EditableSubtitle` — a plain summary that autosaves on a debounce.
 *
 * @remarks
 * The masthead subtitle (project/initiative/program summary) is plain text, not a document — it
 * has no business pulling in {@link EditableFreeformText}'s Markdown editor, whose reserved editor
 * height is what was blowing out the space between the subtitle and the property row below it.
 * This is `EditableTitle`'s click-to-edit pattern (wrap at rest, single-line `<input>` while
 * focused) plus debounced autosave, without the "titles can't be empty" constraint: a cleared
 * subtitle saves as `null`.
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
  /** Whether the viewer may edit; false renders plain, non-interactive, wrappable text. */
  canEdit: boolean;
  /** Accessible label for the edit field, e.g. `"Project summary"`. */
  ariaLabel: string;
  /** Type-scale + color classes applied to BOTH the text and the input so they look identical. */
  className?: string;
  /** Quiet text shown when there's no summary yet (only when editable). */
  placeholder?: string;
}

/** A summary that wraps at rest and edits in place as a single-line input, never reserving a Markdown editor's multi-line height. */
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

  // Focus + select the whole summary when the display span swaps for the input.
  useEffect(() => {
    if (!focused) return;
    const input = inputRef.current;
    if (!input || document.activeElement === input) return;
    input.focus();
    input.select();
  }, [focused]);

  if (!canEdit) {
    return <span className={cn('block', className)}>{baseline.length > 0 ? baseline : ''}</span>;
  }

  if (!focused) {
    return (
      <span
        role="button"
        tabIndex={0}
        onClick={() => {
          setFocused(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setFocused(true);
          }
        }}
        className={cn('block cursor-text', className)}
      >
        {baseline.length > 0 ? baseline : placeholder}
      </span>
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
      className={cn('m-0 w-full min-w-0 border-0 bg-transparent p-0 outline-none', className)}
    />
  );
}
