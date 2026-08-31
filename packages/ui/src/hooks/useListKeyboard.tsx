'use client';

/**
 * `@docket/ui` — grid keyboard navigation for the virtualized {@link ListView}.
 *
 * @remarks
 * Provides roving keyboard navigation over the *flattened* rows of a {@link ListView}
 * (group headers, sub-group headers, and data rows all count as navigable rows). It owns the
 * active row index and translates key presses into index moves and activation:
 *
 * - `ArrowDown` / `ArrowUp` — move the active row by one (clamped to the ends).
 * - `Home` / `End` — jump to the first / last row.
 * - `Enter` — activate the active row (toggles a group, opens a data row).
 * - `Escape` — clear the active row.
 * - an unmodified single letter on an active row — a property-edit hotkey (`onPropertyKey`),
 *   e.g. `L` for labels.
 *
 * A keydown whose target is a text-entry element (an `input`, `textarea`, `select`, or anything
 * `contentEditable`) is ignored entirely, at every key above — a row rendering an inline editor
 * must keep its own keystrokes.
 *
 * The hook is presentation-agnostic: it does not touch the DOM beyond returning an
 * `onKeyDown` handler and the current `activeIndex`, so the {@link ListView} can scroll the
 * active row into view through its virtualizer.
 */
import * as React from 'react';

/** The keyboard event fields {@link useListKeyboard} reads. */
export interface ListKeyboardEvent {
  /** The pressed key value. */
  readonly key: string;
  /** The event's target, used only for the text-entry guard. */
  readonly target?: EventTarget | null;
  /** Modifier state, used only to exclude modified keystrokes from `onPropertyKey`. */
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  /** Prevent the browser's default key behavior when the hook handles it. */
  preventDefault: () => void;
}

/** Options for {@link useListKeyboard}. */
export interface UseListKeyboardOptions {
  /** Total number of navigable (flattened) rows. */
  rowCount: number;
  /** Activate the row at `index` (Enter): toggles a group or opens a data row. */
  onActivate?: (index: number) => void;
  /** Called whenever the active index changes, so the host can scroll it into view. */
  onActiveChange?: (index: number) => void;
  /** The initial active index. Defaults to `-1` (no active row). */
  initialIndex?: number;
  /**
   * Handle a plain (unmodified) single-letter keydown on the active row — a property-edit
   * hotkey (`L` for labels, and future `S`/`A`/`P`/`D`).
   *
   * @remarks
   * Never called when no row is active, when a modifier (`⌘`/`Ctrl`/`Alt`) is held, or when the
   * event target is a text-entry element. Receives the lowercased key and the active row index.
   * Return `true` to consume the keystroke (`preventDefault`); return `false`/`undefined` to let
   * it fall through untouched, so a future in-row editor can still claim the same letter.
   */
  onPropertyKey?: (key: string, index: number) => boolean;
  /** Report a keyboard move after the next active index has been resolved. */
  onMove?: (index: number, event: ListKeyboardEvent) => void;
  /** Toggle the active entry through Space. */
  onToggle?: (index: number, event: ListKeyboardEvent) => void;
  /** Select every eligible entry through Command/Ctrl+A. */
  onSelectAll?: (index: number, event: ListKeyboardEvent) => void;
  /** Clear selection through Escape before the active entry is reset. */
  onClear?: (index: number, event: ListKeyboardEvent) => void;
}

/** The value returned by {@link useListKeyboard}. */
export interface UseListKeyboardResult {
  /** The active (keyboard-focused) row index, or `-1` when none is active. */
  activeIndex: number;
  /** Imperatively set the active row index (clamped to valid range or `-1`). */
  setActiveIndex: (index: number) => void;
  /** The `onKeyDown` handler to spread onto the grid container. */
  onKeyDown: (event: ListKeyboardEvent) => void;
}

/** Clamp `index` to `[-1, rowCount - 1]`. */
function clampIndex(index: number, rowCount: number): number {
  if (index < 0) return -1;
  if (index > rowCount - 1) return rowCount - 1;
  return index;
}

/** Whether a keydown's target is an element that owns its own keystrokes. */
function isTextEntryTarget(target: EventTarget | null | undefined): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Whether `key` is a single, unmodified letter eligible for `onPropertyKey` dispatch. */
function isPlainLetterKey(event: ListKeyboardEvent): boolean {
  return /^[a-zA-Z]$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey;
}

/** Return the next index for one navigation key, or `null` for a non-navigation key. */
function navigationIndex(key: string, activeIndex: number, rowCount: number): number | null {
  switch (key) {
    case 'ArrowDown':
      return clampIndex(activeIndex < 0 ? 0 : activeIndex + 1, rowCount);
    case 'ArrowUp':
      return clampIndex(activeIndex < 0 ? rowCount - 1 : activeIndex - 1, rowCount);
    case 'Home':
      return clampIndex(0, rowCount);
    case 'End':
      return clampIndex(rowCount - 1, rowCount);
    default:
      return null;
  }
}

/** Dispatch Command/Ctrl+A when the host supplied a selection handler. */
function handleSelectAllShortcut(
  event: ListKeyboardEvent,
  activeIndex: number,
  onSelectAll: UseListKeyboardOptions['onSelectAll'],
): boolean {
  if (!onSelectAll || (!event.metaKey && !event.ctrlKey) || event.key.toLowerCase() !== 'a') {
    return false;
  }
  event.preventDefault();
  onSelectAll(activeIndex, event);
  return true;
}

/** Dispatch an unmodified property letter when the host claims it. */
function handlePropertyShortcut(
  event: ListKeyboardEvent,
  activeIndex: number,
  onPropertyKey: UseListKeyboardOptions['onPropertyKey'],
): boolean {
  if (!onPropertyKey || activeIndex < 0 || !isPlainLetterKey(event)) return false;
  if (!onPropertyKey(event.key.toLowerCase(), activeIndex)) return false;
  event.preventDefault();
  return true;
}

/**
 * Manage arrow / Enter / Esc / property-key grid keyboard navigation over flattened list rows.
 *
 * @param options - The row count and activation/active-change/property-key callbacks.
 * @returns the active index, an imperative setter, and the grid `onKeyDown` handler.
 *
 * @example
 * ```tsx
 * const { activeIndex, onKeyDown } = useListKeyboard({ rowCount: rows.length, onActivate });
 * return <div role="grid" onKeyDown={onKeyDown}>{...}</div>;
 * ```
 */
export function useListKeyboard({
  rowCount,
  onActivate,
  onActiveChange,
  initialIndex = -1,
  onPropertyKey,
  onMove,
  onToggle,
  onSelectAll,
  onClear,
}: UseListKeyboardOptions): UseListKeyboardResult {
  const [activeIndex, setActiveIndexState] = React.useState<number>(initialIndex);

  const setActiveIndex = React.useCallback(
    (index: number) => {
      const next = clampIndex(index, rowCount);
      setActiveIndexState(next);
      if (next >= 0) onActiveChange?.(next);
    },
    [rowCount, onActiveChange],
  );

  // Keep the active index valid if rows are removed (e.g. a group collapses).
  React.useEffect(() => {
    setActiveIndexState((current) => (current > rowCount - 1 ? rowCount - 1 : current));
  }, [rowCount]);

  const onKeyDown = React.useCallback(
    (event: ListKeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return;
      if (handleSelectAllShortcut(event, activeIndex, onSelectAll)) return;
      if (handlePropertyShortcut(event, activeIndex, onPropertyKey)) return;

      const next = navigationIndex(event.key, activeIndex, rowCount);
      if (next !== null) {
        event.preventDefault();
        setActiveIndex(next);
        onMove?.(next, event);
        return;
      }
      if (event.key === 'Enter' && activeIndex >= 0) {
        event.preventDefault();
        onActivate?.(activeIndex);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        onClear?.(activeIndex, event);
        setActiveIndexState(-1);
        return;
      }
      if (event.key === ' ' && onToggle && activeIndex >= 0) {
        event.preventDefault();
        onToggle(activeIndex, event);
      }
    },
    [
      activeIndex,
      rowCount,
      onActivate,
      setActiveIndex,
      onPropertyKey,
      onMove,
      onToggle,
      onSelectAll,
      onClear,
    ],
  );

  return { activeIndex, setActiveIndex, onKeyDown };
}
