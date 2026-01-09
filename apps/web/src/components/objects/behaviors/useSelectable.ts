'use client';

/**
 * useSelectable - Selection Behavior Hook
 *
 * Provides selection behavior for any element. Handles single-click,
 * cmd+click (toggle), and shift+click (range) selection patterns.
 */

import { useCallback, useMemo, type MouseEvent, type KeyboardEvent } from 'react';
import { useSelection, useIsSelected } from '../context/SelectionContext';
import type { SurfaceId } from '../types';

// =============================================================================
// Types
// =============================================================================

interface UseSelectableOptions {
  /** Unique ID of the selectable item */
  id: string;

  /** Surface this item belongs to */
  surfaceId: SurfaceId;

  /** Ordered list of IDs for range selection */
  orderedIds?: string[];

  /** Whether selection is disabled */
  disabled?: boolean;

  /** Callback when selection changes */
  onSelectionChange?: (selected: boolean) => void;
}

interface UseSelectableReturn {
  /** Whether this item is currently selected */
  isSelected: boolean;

  /** Props to spread on the selectable element */
  selectableProps: {
    onClick: (event: MouseEvent) => void;
    onKeyDown: (event: KeyboardEvent) => void;
    'aria-selected': boolean;
    tabIndex: number;
    role: string;
    'data-selected': boolean;
  };

  /** Select this item (clears others) */
  select: () => void;

  /** Toggle selection */
  toggle: () => void;

  /** Add to selection */
  addToSelection: () => void;

  /** Remove from selection */
  removeFromSelection: () => void;
}

// =============================================================================
// Hook
// =============================================================================

export function useSelectable({
  id,
  surfaceId,
  orderedIds = [],
  disabled = false,
  onSelectionChange,
}: UseSelectableOptions): UseSelectableReturn {
  const selection = useSelection();
  const isSelected = useIsSelected(id);

  const select = useCallback(() => {
    if (disabled) return;
    selection.select(id, surfaceId);
    onSelectionChange?.(true);
  }, [disabled, selection, id, surfaceId, onSelectionChange]);

  const toggle = useCallback(() => {
    if (disabled) return;
    selection.toggle(id, surfaceId);
    onSelectionChange?.(!isSelected);
  }, [disabled, selection, id, surfaceId, isSelected, onSelectionChange]);

  const addToSelection = useCallback(() => {
    if (disabled) return;
    selection.addToSelection(id, surfaceId);
    onSelectionChange?.(true);
  }, [disabled, selection, id, surfaceId, onSelectionChange]);

  const removeFromSelection = useCallback(() => {
    if (disabled) return;
    selection.removeFromSelection(id);
    onSelectionChange?.(false);
  }, [disabled, selection, id, onSelectionChange]);

  const handleClick = useCallback(
    (event: MouseEvent) => {
      if (disabled) return;

      // Prevent text selection on shift+click
      if (event.shiftKey) {
        event.preventDefault();
      }

      if (event.shiftKey && selection.state.anchor) {
        // Shift+click: range select from anchor to this item
        selection.selectRange(selection.state.anchor, id, orderedIds, surfaceId);
      } else if (event.metaKey || event.ctrlKey) {
        // Cmd/Ctrl+click: toggle selection
        toggle();
      } else {
        // Regular click: single select
        select();
      }
    },
    [disabled, selection, id, orderedIds, surfaceId, toggle, select],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (disabled) return;

      switch (event.key) {
        case 'Enter':
        case ' ':
          event.preventDefault();
          if (event.shiftKey) {
            toggle();
          } else {
            select();
          }
          break;
        case 'a':
          if (event.metaKey || event.ctrlKey) {
            event.preventDefault();
            selection.selectAll(orderedIds, surfaceId);
          }
          break;
        case 'Escape':
          selection.clear();
          break;
      }
    },
    [disabled, selection, orderedIds, surfaceId, toggle, select],
  );

  const selectableProps = useMemo(
    () => ({
      onClick: handleClick,
      onKeyDown: handleKeyDown,
      'aria-selected': isSelected,
      tabIndex: disabled ? -1 : 0,
      role: 'option',
      'data-selected': isSelected,
    }),
    [handleClick, handleKeyDown, isSelected, disabled],
  );

  return {
    isSelected,
    selectableProps,
    select,
    toggle,
    addToSelection,
    removeFromSelection,
  };
}
