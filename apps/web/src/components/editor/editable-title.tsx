'use client';

/**
 * `EditableTitle` — a single-line title/name that reads as text until you edit it in place.
 *
 * @remarks
 * The counterpart to {@link EditableFreeformText} for one-line strings (titles/names), not bodies:
 * no Markdown editor, no toolbar, no separate "Edit" mode chrome. The display text and the edit
 * input share the same `className`, so entering edit swaps a `<span>` for an identically styled
 * `<input>` with no layout shift. `Enter`/blur saves, `Escape` reverts, and an empty value reverts
 * (titles cannot be emptied), so `onSave` never fires with an empty string. When `canEdit` is false
 * it is plain, non-interactive text.
 *
 * Two activation modes:
 * - `click` (default, for detail headings): a single click enters edit — nothing competes for it.
 * - `doubleClick` (for navigable list rows): a **double-click** enters edit, while a **single**
 *   click runs the row's {@link EditableTitleProps.onActivate} (open) — after a short delay so the
 *   double-click can pre-empt the open. The element `stopPropagation`s so the row's own click never
 *   double-fires. This is what lets a row both open on click and rename on double-click.
 */
import { cn } from '@docket/ui/lib/utils';
import { type JSX, useEffect, useRef, useState } from 'react';

/** Delay before a single click on a `doubleClick`-mode title opens the row, so a double-click wins. */
const OPEN_AFTER_SINGLE_CLICK_MS = 220;

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
  /** The row's open action; in `doubleClick` mode a single click runs this. Ignored in `click` mode. */
  onActivate?: () => void;
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
  onActivate,
  ariaLabel,
  className,
  placeholder = 'Untitled',
}: EditableTitleProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Never leave a pending single-click open timer behind.
  useEffect(
    () => () => {
      if (openTimer.current) clearTimeout(openTimer.current);
    },
    [],
  );

  const clearOpenTimer = (): void => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  };

  const commit = (): void => {
    const next = draft.trim();
    if (next.length > 0 && next !== value) onSave(next);
    setEditing(false);
  };
  const cancel = (): void => {
    setDraft(value);
    setEditing(false);
  };
  const enter = (): void => {
    clearOpenTimer();
    setEditing(true);
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
        onClick={(event) => {
          // Inside a row, keep the click from bubbling to the row's open handler while editing.
          event.stopPropagation();
        }}
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

  if (activate === 'doubleClick') {
    return (
      <span
        onClick={(event) => {
          // Own the title's click so the row can't open behind us; defer the open so a double-click
          // (edit) can cancel it. Clicks elsewhere on the row open immediately via the row itself.
          if (!onActivate) return;
          // stopPropagation blocks a row's onClick; preventDefault blocks an <a href> ancestor's
          // navigation — so the title owns the gesture whether the row opens via handler or link.
          event.stopPropagation();
          event.preventDefault();
          clearOpenTimer();
          openTimer.current = setTimeout(() => {
            openTimer.current = null;
            onActivate();
          }, OPEN_AFTER_SINGLE_CLICK_MS);
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          enter();
        }}
        className={cn('cursor-text', className)}
      >
        {value.length > 0 ? value : placeholder}
      </span>
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`${ariaLabel}: ${value}. Edit.`}
      onClick={(event) => {
        event.stopPropagation();
        enter();
      }}
      onKeyDown={(event) => {
        if (event.key === 'F2' || event.key === 'Enter') {
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
