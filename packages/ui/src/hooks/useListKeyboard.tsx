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
 *
 * The hook is presentation-agnostic: it does not touch the DOM beyond returning an
 * `onKeyDown` handler and the current `activeIndex`, so the {@link ListView} can scroll the
 * active row into view through its virtualizer.
 */
import * as React from 'react';

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
}

/** The value returned by {@link useListKeyboard}. */
export interface UseListKeyboardResult {
  /** The active (keyboard-focused) row index, or `-1` when none is active. */
  activeIndex: number;
  /** Imperatively set the active row index (clamped to valid range or `-1`). */
  setActiveIndex: (index: number) => void;
  /** The `onKeyDown` handler to spread onto the grid container. */
  onKeyDown: (event: React.KeyboardEvent) => void;
}

/** Clamp `index` to `[-1, rowCount - 1]`. */
function clampIndex(index: number, rowCount: number): number {
  if (index < 0) return -1;
  if (index > rowCount - 1) return rowCount - 1;
  return index;
}

/**
 * Manage arrow / Enter / Esc grid keyboard navigation over flattened list rows.
 *
 * @param options - The row count and activation/active-change callbacks.
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
    (event: React.KeyboardEvent) => {
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
    [activeIndex, rowCount, onActivate, setActiveIndex],
  );

  return { activeIndex, setActiveIndex, onKeyDown };
}
