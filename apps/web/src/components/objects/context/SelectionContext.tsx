'use client';

/**
 * Selection Context
 *
 * Manages single and multi-select state across the application.
 * Supports cmd+click for toggle, shift+click for range selection.
 */

import { createContext, useContext, useCallback, useMemo, useState, type ReactNode } from 'react';
import type { SurfaceId } from '../types';

// =============================================================================
// Types
// =============================================================================

interface SelectionState {
  /** Set of selected object IDs */
  selected: Set<string>;

  /** Anchor ID for shift-select range */
  anchor: string | null;

  /** Last selected ID (for range calculations) */
  lastSelected: string | null;

  /** Currently focused surface (where selection events come from) */
  focusedSurface: SurfaceId | null;
}

interface SelectionContextValue {
  /** Current selection state */
  state: SelectionState;

  /** Select a single object (clears other selections) */
  select: (id: string, surfaceId?: SurfaceId) => void;

  /** Toggle selection (for cmd+click) */
  toggle: (id: string, surfaceId?: SurfaceId) => void;

  /** Select a range (for shift+click) */
  selectRange: (fromId: string, toId: string, orderedIds: string[], surfaceId?: SurfaceId) => void;

  /** Add to selection without clearing */
  addToSelection: (id: string, surfaceId?: SurfaceId) => void;

  /** Remove from selection */
  removeFromSelection: (id: string) => void;

  /** Select all objects in a surface */
  selectAll: (ids: string[], surfaceId?: SurfaceId) => void;

  /** Clear all selections */
  clear: () => void;

  /** Check if an object is selected */
  isSelected: (id: string) => boolean;

  /** Get number of selected items */
  count: number;

  /** Get all selected IDs as array */
  selectedIds: string[];

  /** Set the focused surface */
  setFocusedSurface: (surfaceId: SurfaceId | null) => void;
}

// =============================================================================
// Context
// =============================================================================

const SelectionContext = createContext<SelectionContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface SelectionProviderProps {
  children: ReactNode;
}

export function SelectionProvider({ children }: SelectionProviderProps) {
  const [state, setState] = useState<SelectionState>({
    selected: new Set(),
    anchor: null,
    lastSelected: null,
    focusedSurface: null,
  });

  const select = useCallback((id: string, surfaceId?: SurfaceId) => {
    setState((prev) => ({
      selected: new Set([id]),
      anchor: id,
      lastSelected: id,
      focusedSurface: surfaceId ?? prev.focusedSurface,
    }));
  }, []);

  const toggle = useCallback((id: string, surfaceId?: SurfaceId) => {
    setState((prev) => {
      const newSelected = new Set(prev.selected);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      return {
        selected: newSelected,
        anchor: id,
        lastSelected: id,
        focusedSurface: surfaceId ?? prev.focusedSurface,
      };
    });
  }, []);

  const selectRange = useCallback(
    (fromId: string, toId: string, orderedIds: string[], surfaceId?: SurfaceId) => {
      setState((prev) => {
        const fromIndex = orderedIds.indexOf(fromId);
        const toIndex = orderedIds.indexOf(toId);

        if (fromIndex === -1 || toIndex === -1) {
          // Can't determine range, just select the target
          return {
            selected: new Set([toId]),
            anchor: toId,
            lastSelected: toId,
            focusedSurface: surfaceId ?? prev.focusedSurface,
          };
        }

        const start = Math.min(fromIndex, toIndex);
        const end = Math.max(fromIndex, toIndex);
        const rangeIds = orderedIds.slice(start, end + 1);

        return {
          selected: new Set(rangeIds),
          anchor: prev.anchor, // Keep original anchor
          lastSelected: toId,
          focusedSurface: surfaceId ?? prev.focusedSurface,
        };
      });
    },
    [],
  );

  const addToSelection = useCallback((id: string, surfaceId?: SurfaceId) => {
    setState((prev) => {
      const newSelected = new Set(prev.selected);
      newSelected.add(id);
      return {
        selected: newSelected,
        anchor: prev.anchor ?? id,
        lastSelected: id,
        focusedSurface: surfaceId ?? prev.focusedSurface,
      };
    });
  }, []);

  const removeFromSelection = useCallback((id: string) => {
    setState((prev) => {
      const newSelected = new Set(prev.selected);
      newSelected.delete(id);
      return {
        ...prev,
        selected: newSelected,
        anchor: prev.anchor === id ? null : prev.anchor,
        lastSelected: prev.lastSelected === id ? null : prev.lastSelected,
      };
    });
  }, []);

  const selectAll = useCallback((ids: string[], surfaceId?: SurfaceId) => {
    setState((prev) => ({
      selected: new Set(ids),
      anchor: ids[0] ?? null,
      lastSelected: ids[ids.length - 1] ?? null,
      focusedSurface: surfaceId ?? prev.focusedSurface,
    }));
  }, []);

  const clear = useCallback(() => {
    setState((prev) => ({
      selected: new Set(),
      anchor: null,
      lastSelected: null,
      focusedSurface: prev.focusedSurface,
    }));
  }, []);

  const isSelected = useCallback(
    (id: string): boolean => {
      return state.selected.has(id);
    },
    [state.selected],
  );

  const setFocusedSurface = useCallback((surfaceId: SurfaceId | null) => {
    setState((prev) => ({
      ...prev,
      focusedSurface: surfaceId,
    }));
  }, []);

  const selectedIds = useMemo(() => Array.from(state.selected), [state.selected]);

  const count = state.selected.size;

  const value = useMemo(
    (): SelectionContextValue => ({
      state,
      select,
      toggle,
      selectRange,
      addToSelection,
      removeFromSelection,
      selectAll,
      clear,
      isSelected,
      count,
      selectedIds,
      setFocusedSurface,
    }),
    [
      state,
      select,
      toggle,
      selectRange,
      addToSelection,
      removeFromSelection,
      selectAll,
      clear,
      isSelected,
      count,
      selectedIds,
      setFocusedSurface,
    ],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Access the selection context.
 */
export function useSelection(): SelectionContextValue {
  const context = useContext(SelectionContext);
  if (!context) {
    throw new Error('useSelection must be used within a SelectionProvider');
  }
  return context;
}

/**
 * Check if a specific object is selected.
 */
export function useIsSelected(id: string): boolean {
  const { isSelected } = useSelection();
  return isSelected(id);
}

/**
 * Get selection handlers for an object.
 */
export function useSelectionHandlers(id: string, surfaceId: SurfaceId, orderedIds: string[]) {
  const { select, toggle, selectRange, state } = useSelection();

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.shiftKey && state.anchor) {
        // Shift+click: range select
        selectRange(state.anchor, id, orderedIds, surfaceId);
      } else if (event.metaKey || event.ctrlKey) {
        // Cmd/Ctrl+click: toggle
        toggle(id, surfaceId);
      } else {
        // Regular click: single select
        select(id, surfaceId);
      }
    },
    [id, surfaceId, orderedIds, select, toggle, selectRange, state.anchor],
  );

  return { handleClick };
}
