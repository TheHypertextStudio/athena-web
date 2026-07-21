'use client';

/**
 * `EditableTitle` — a single-line title/name that reads as text until you edit it in place.
 *
 * @remarks
 * The counterpart to {@link EditableFreeformText} for one-line strings (titles/names), not bodies:
 * there is no Markdown editor, no toolbar, and no separate "Edit" mode chrome. The display text and
 * the edit input share the same `className`, so entering edit swaps a `<span>` for an identically
 * styled `<input>` with no layout shift — the caret simply appears in the same glyphs, honoring the
 * app's no-hard-swap rule. `Enter`/blur saves, `Escape` reverts, and an empty value reverts (titles
 * cannot be emptied), so `onSave` never fires with an empty string. When `canEdit` is false it is
 * plain, non-interactive text. On a detail heading nothing competes for the click, so `activate`
 * defaults to `click`; inside a navigable row pass `doubleClick` (single click still opens the row)
 * and `F2` triggers edit from the keyboard.
 */
import { cn } from '@docket/ui/lib/utils';
import { type JSX, useEffect, useRef, useState } from 'react';

/** Props for {@link EditableTitle}. */
export interface EditableTitleProps {
  /** The current title/name. */
  value: string;
  /** Persist a new, non-empty, changed title. Never called with an empty or unchanged value. */
  onSave: (next: string) => void;
  /** Whether the viewer may edit; false renders plain, non-interactive text. */
  canEdit: boolean;
  /** Disable the field while a save is in flight. */
  saving?: boolean;
  /** How editing begins — `click` for headings, `doubleClick` inside a navigable row. */
  activate?: 'click' | 'doubleClick';
  /** Accessible label for the edit field, e.g. `"Task title"`. */
  ariaLabel: string;
  /** Type-scale + color classes applied to BOTH the text and the input so they look identical. */
  className?: string;
  /** Quiet text shown when `value` is empty (only when editable — titles shouldn't be empty). */
  placeholder?: string;
}

/** A single-line title that edits in place. */
export function EditableTitle({
  value,
  onSave,
  canEdit,
  saving = false,
  activate = 'click',
  ariaLabel,
  className,
  placeholder = 'Untitled',
}: EditableTitleProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the draft in sync with external updates while not actively editing.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  // Focus + select the whole title when entering edit, so typing replaces it.
  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [editing]);

  const commit = (): void => {
    const next = draft.trim();
    if (next.length > 0 && next !== value) onSave(next);
    setEditing(false);
  };
  const cancel = (): void => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        disabled={saving}
        aria-label={ariaLabel}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
          }
        }}
        className={cn('m-0 w-full border-0 bg-transparent p-0 outline-none', className)}
      />
    );
  }

  if (!canEdit) {
    return <span className={className}>{value.length > 0 ? value : placeholder}</span>;
  }

  const enter = (): void => {
    setEditing(true);
  };
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`${ariaLabel}: ${value}. Edit.`}
      onClick={
        activate === 'click'
          ? (event) => {
              // Inside a navigable row this also keeps the row's own handler from firing.
              event.stopPropagation();
              enter();
            }
          : undefined
      }
      onDoubleClick={
        activate === 'doubleClick'
          ? (event) => {
              event.stopPropagation();
              enter();
            }
          : undefined
      }
      onKeyDown={(event) => {
        if (event.key === 'F2' || (activate === 'click' && event.key === 'Enter')) {
          event.preventDefault();
          enter();
        }
      }}
      className={cn(
        'hover:bg-surface-container-low focus-visible:ring-ring cursor-text rounded-sm focus-visible:ring-2 focus-visible:outline-none',
        className,
      )}
    >
      {value.length > 0 ? value : placeholder}
    </span>
  );
}
