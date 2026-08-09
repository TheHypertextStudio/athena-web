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

      if (onPropertyKey && activeIndex >= 0 && isPlainLetterKey(event)) {
        const handled = onPropertyKey(event.key.toLowerCase(), activeIndex);
        if (handled) {
          event.preventDefault();
          return;
        }
      }

      switch (event.key) {
        case 'ArrowDown': {
          event.preventDefault();
          setActiveIndex(activeIndex < 0 ? 0 : activeIndex + 1);
          break;
        }
        case 'ArrowUp': {
          event.preventDefault();
          setActiveIndex(activeIndex < 0 ? rowCount - 1 : activeIndex - 1);
          break;
        }
        case 'Home': {
          event.preventDefault();
          setActiveIndex(0);
          break;
        }
        case 'End': {
          event.preventDefault();
          setActiveIndex(rowCount - 1);
          break;
        }
        case 'Enter': {
          if (activeIndex >= 0) {
            event.preventDefault();
            onActivate?.(activeIndex);
          }
          break;
        }
        case 'Escape': {
          event.preventDefault();
          setActiveIndexState(-1);
          break;
        }
        default:
          break;
      }
    },
    [activeIndex, rowCount, onActivate, setActiveIndex, onPropertyKey],
  );

  return { activeIndex, setActiveIndex, onKeyDown };
}
