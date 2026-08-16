'use client';

/**
 * `EditableTitle` — a single-line title/name that autosaves on a debounce, never a click-to-save
 * flow.
 *
 * @remarks
 * The counterpart to {@link EditableFreeformText} for one-line strings (titles/names), not bodies:
 * no Markdown editor, no toolbar, no separate "Edit" mode chrome. In `click` mode (detail headings)
 * the field is always an editable control — there is no separate read/edit toggle to click into —
 * and it is a `<textarea>` rather than an `<input>` for one reason: a heading has to wrap. An
 * `<input>` is inherently one line, so a long title clipped mid-word on a narrow viewport; a
 * textarea that auto-grows to its wrapped content reads exactly like the heading it replaces while
 * staying live. `Enter` is bound to save rather than to a newline, so it is single-line in the only
 * sense that matters to the caller.
 *
 * The resting state is deliberately not a `<span>` that swaps for a field on click. That trades a
 * clipped title for a hard view swap plus an extra click before anyone can type, and swapping views
 * is the thing this app does not do.
 *
 * Edits persist via {@link useDebouncedAutosave} the same way the body does, so the field is never
 * `disabled` while a save is in flight (optimistic updates make that unnecessary). An empty value
 * reverts to the last saved title on blur (titles cannot be emptied). `Enter` forces an immediate
 * save (rather than waiting out the debounce) and blurs the field; the pending debounce for that
 * same value is a no-op once it fires because `lastSaved` already matches it.
 *
 * `doubleClick` mode (for navigable list rows) keeps a distinct activation gesture because the
 * click is already spoken for by the row's open action: a **double-click** enters edit, while a
 * **single** click runs the row's {@link EditableTitleProps.onActivate} (open) — after a short delay
 * so the double-click can pre-empt the open.
 */
import { cn } from '@docket/ui/lib/utils';
import { type JSX, useEffect, useRef, useState } from 'react';

import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';

import { useAutosizeTextarea } from './use-autosize-textarea';

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
  const fieldRef = useRef<HTMLTextAreaElement>(null);
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

  // Focus + select the whole title when a doubleClick-mode row swaps its span for the field.
  useEffect(() => {
    if (!focused) return;
    const field = fieldRef.current;
    if (!field || document.activeElement === field) return;
    field.focus();
    field.select();
  }, [focused]);

  // A detail title can gain or lose lines when the viewport or its adjacent actions change width,
  // even though its value did not change. Keep its height fitted for both causes.
  useAutosizeTextarea(fieldRef, draft);

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
          // A single click on this title *opens the row*; only a double-click edits. A text cursor
          // would advertise "type here" over the app's primary navigation gesture, so the title
          // inherits the row's pointer instead.
          className={cn('cursor-pointer', className)}
        >
          {value.length > 0 ? value : placeholder}
        </span>
      );
    }
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
        revertIfEmpty();
      }}
      onClick={(event) => {
        // Inside a row, keep the click from bubbling to the row's own open handler.
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          // A title is one line's worth of meaning even when it wraps across two, so Enter saves
          // rather than inserting the newline a textarea would otherwise take.
          event.preventDefault();
          commit(draft);
          fieldRef.current?.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          setDraft(value);
          fieldRef.current?.blur();
        }
      }}
      className={cn(
        'm-0 [field-sizing:content] w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none',
        // Tapped to focus, so it answers to the same coarse floor every other control does.
        'coarse:min-h-10',
        className,
      )}
    />
  );
}
