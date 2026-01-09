/**
 * Undo Provider
 *
 * Context provider that sets up the undo/redo system, registers keyboard
 * shortcuts, and provides access to undo functionality throughout the app.
 *
 * @packageDocumentation
 */

'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useUndoExecutor } from './use-undo-executor';
import { registerUndoShortcuts } from './register-shortcuts';
import type { UndoStackItem } from './types';

/**
 * Undo context value.
 */
interface UndoContextValue {
  /** Perform an undo operation */
  performUndo: () => Promise<boolean>;
  /** Perform a redo operation */
  performRedo: () => Promise<boolean>;
  /** Undo to a specific point in history */
  undoTo: (commandId: string) => Promise<boolean>;
  /** Clear all history */
  clearHistory: () => void;
  /** Whether undo is available */
  canUndo: boolean;
  /** Whether redo is available */
  canRedo: boolean;
  /** Whether an undo/redo operation is in progress */
  isProcessing: boolean;
  /** Description of what will be undone */
  undoDescription: string | null;
  /** Description of what will be redone */
  redoDescription: string | null;
  /** Full undo history (for history panel) */
  history: UndoStackItem[];
  /** Whether history panel is open */
  isHistoryOpen: boolean;
  /** Open the history panel */
  openHistory: () => void;
  /** Close the history panel */
  closeHistory: () => void;
  /** Toggle history panel */
  toggleHistory: () => void;
}

const UndoContext = createContext<UndoContextValue | null>(null);

/**
 * Props for UndoProvider.
 */
interface UndoProviderProps {
  children: ReactNode;
}

/**
 * Provider component that sets up the undo/redo system.
 *
 * This provider:
 * 1. Initializes the undo executor
 * 2. Registers Cmd+Z / Cmd+Shift+Z keyboard shortcuts
 * 3. Provides context for accessing undo functionality
 * 4. Manages history panel open/close state
 *
 * @example
 * ```tsx
 * // In layout.tsx
 * <QueryClientProvider>
 *   <SnackbarProvider>
 *     <UndoProvider>
 *       <ObjectSystemProvider>
 *         {children}
 *       </ObjectSystemProvider>
 *     </UndoProvider>
 *   </SnackbarProvider>
 * </QueryClientProvider>
 * ```
 */
export function UndoProvider({ children }: UndoProviderProps) {
  const executor = useUndoExecutor();
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const openHistory = useCallback(() => {
    setIsHistoryOpen(true);
  }, []);
  const closeHistory = useCallback(() => {
    setIsHistoryOpen(false);
  }, []);
  const toggleHistory = useCallback(() => {
    setIsHistoryOpen((prev) => !prev);
  }, []);

  // Register keyboard shortcuts
  useEffect(() => {
    const cleanup = registerUndoShortcuts({
      onUndo: executor.performUndo,
      onRedo: executor.performRedo,
      onOpenHistory: toggleHistory,
    });

    return cleanup;
  }, [executor.performUndo, executor.performRedo, toggleHistory]);

  const value: UndoContextValue = {
    performUndo: executor.performUndo,
    performRedo: executor.performRedo,
    undoTo: executor.undoTo,
    clearHistory: executor.clearHistory,
    canUndo: executor.canUndo,
    canRedo: executor.canRedo,
    isProcessing: executor.isProcessing,
    undoDescription: executor.undoDescription,
    redoDescription: executor.redoDescription,
    history: executor.history,
    isHistoryOpen,
    openHistory,
    closeHistory,
    toggleHistory,
  };

  return <UndoContext.Provider value={value}>{children}</UndoContext.Provider>;
}

/**
 * Hook to access undo/redo functionality.
 *
 * @throws Error if used outside UndoProvider
 *
 * @example
 * ```typescript
 * function UndoButton() {
 *   const { performUndo, canUndo, undoDescription } = useUndo();
 *
 *   return (
 *     <button
 *       onClick={() => performUndo()}
 *       disabled={!canUndo}
 *       title={undoDescription ? `Undo: ${undoDescription}` : 'Nothing to undo'}
 *     >
 *       Undo
 *     </button>
 *   );
 * }
 * ```
 */
export function useUndo(): UndoContextValue {
  const context = useContext(UndoContext);
  if (!context) {
    throw new Error('useUndo must be used within an UndoProvider');
  }
  return context;
}
