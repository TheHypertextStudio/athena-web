'use client';

/**
 * `EditableTitle` — a single-line title/name that autosaves on a debounce, never a click-to-save
 * flow.
 *
 * @remarks
 * The counterpart to {@link EditableFreeformText} for one-line strings (titles/names), not bodies:
 * no Markdown editor, no toolbar, no separate "Edit" mode chrome. In `click` mode (detail headings)
 * the field is always an editable `<input>` — there is no separate read/edit toggle to click into —
 * and edits persist via {@link useDebouncedAutosave} the same way the body does, so the field is
 * never `disabled` while a save is in flight (optimistic updates make that unnecessary). An empty
 * value reverts to the last saved title on blur (titles cannot be emptied). `Enter` forces an
 * immediate save (rather than waiting out the debounce) and blurs the field; the pending debounce
 * for that same value is a no-op once it fires because `lastSaved` already matches it.
 *
 * `doubleClick` mode (for navigable list rows) keeps a distinct activation gesture because the
 * click is already spoken for by the row's open action: a **double-click** enters edit, while a
 * **single** click runs the row's {@link EditableTitleProps.onActivate} (open) — after a short delay
 * so the double-click can pre-empt the open.
 */
import { cn } from '@docket/ui/lib/utils';
import { type JSX, useEffect, useRef, useState } from 'react';

import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';

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
  activate = 'click',
  onActivate,
  ariaLabel,
  className,
  placeholder = 'Untitled',
}: EditableTitleProps): JSX.Element {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The most recent value we've asked `onSave` to persist, so a forced Enter-save doesn't get
  // re-sent a second time when the debounce it pre-empted fires afterward.
  const lastSaved = useRef(value);

  // Keep the draft in sync with external updates while not actively focused.
  useEffect(() => {
    if (!focused) setDraft(value);
    lastSaved.current = value;
  }, [value, focused]);

  const commit = (next: string): void => {
    const trimmed = next.trim();
    if (trimmed.length > 0 && trimmed !== lastSaved.current) {
      lastSaved.current = trimmed;
      onSave(trimmed);
    }
  };

  useDebouncedAutosave({
    value: draft,
    baseline: value,
    save: commit,
  });

  // Never leave a pending single-click open timer behind.
  useEffect(
    () => () => {
      if (openTimer.current) clearTimeout(openTimer.current);
    },
    [],
  );

  // Focus + select the whole title when a doubleClick-mode row swaps its span for the input.
  useEffect(() => {
    if (!focused) return;
    const input = inputRef.current;
    if (!input || document.activeElement === input) return;
    input.focus();
    input.select();
  }, [focused]);

  const clearOpenTimer = (): void => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  };

  const revertIfEmpty = (): void => {
    if (draft.trim().length === 0) setDraft(value);
  };

  if (!canEdit) {
    return <span className={className}>{value.length > 0 ? value : placeholder}</span>;
  }

  if (activate === 'doubleClick') {
    if (!focused) {
      return (
        <span
          onClick={(event) => {
            // Own the title's click so the row can't open behind us; defer the open so a
            // double-click (edit) can cancel it. Clicks elsewhere on the row open immediately.
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
            clearOpenTimer();
            setFocused(true);
          }}
          className={cn('cursor-text', className)}
        >
          {value.length > 0 ? value : placeholder}
        </span>
      );
    }
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
        revertIfEmpty();
      }}
      onClick={(event) => {
        // Inside a row, keep the click from bubbling to the row's own open handler.
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit(draft);
          inputRef.current?.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          setDraft(value);
          inputRef.current?.blur();
        }
      }}
      className={cn('m-0 w-full border-0 bg-transparent p-0 outline-none', className)}
    />
  );
}
