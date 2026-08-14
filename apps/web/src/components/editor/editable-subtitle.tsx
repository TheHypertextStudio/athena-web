'use client';

/**
 * `EditableSubtitle` — a plain summary that autosaves on a debounce.
 *
 * @remarks
 * The masthead subtitle (project/initiative/program summary) is plain text, not a document — it
 * has no business pulling in {@link EditableFreeformText}'s Markdown editor, whose reserved editor
 * height is what was blowing out the space between the subtitle and the property row below it.
 * This is `EditableTitle`'s always-live field (an auto-growing `<textarea>`, so the summary wraps
 * instead of clipping and there is no read/edit view to swap between) plus debounced autosave,
 * without the "titles can't be empty" constraint: a cleared subtitle saves as `null`.
 */
import { cn } from '@docket/ui/lib/utils';
import { type JSX, useEffect, useRef, useState } from 'react';

import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';

import { useAutosizeTextarea } from './use-autosize-textarea';

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

/** A summary that wraps and edits in place, never reserving a Markdown editor's multi-line height. */
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
  const fieldRef = useRef<HTMLTextAreaElement>(null);
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

  // Focus + select the whole summary when something else hands the field focus.
  useEffect(() => {
    if (!focused) return;
    const field = fieldRef.current;
    if (!field || document.activeElement === field) return;
    field.focus();
    field.select();
  }, [focused]);

  // The available width changes as the pane and its masthead change state, so value-only sizing
  // would leave this field at its former one-line height and clip the newly wrapped text.
  useAutosizeTextarea(fieldRef, draft);

  if (!canEdit) {
    return <span className={cn('block', className)}>{baseline.length > 0 ? baseline : ''}</span>;
  }

  return (
    <textarea
      ref={fieldRef}
      rows={1}
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
          fieldRef.current?.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          setDraft(baseline);
          fieldRef.current?.blur();
        }
      }}
      className={cn(
        'm-0 [field-sizing:content] w-full min-w-0 resize-none overflow-hidden border-0 bg-transparent p-0 outline-none',
        className,
      )}
    />
  );
}
