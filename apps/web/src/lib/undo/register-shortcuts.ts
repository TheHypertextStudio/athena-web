/**
 * Undo/Redo Keyboard Shortcuts
 *
 * Registers global keyboard shortcuts for undo/redo operations.
 * Uses the existing shortcut manager system for consistency.
 *
 * @packageDocumentation
 */

import { getShortcutManager } from '@/lib/command-palette/shortcuts';

/**
 * Callbacks for undo/redo operations.
 */
export interface UndoShortcutCallbacks {
  onUndo: () => Promise<boolean>;
  onRedo: () => Promise<boolean>;
  onOpenHistory?: () => void;
}

/**
 * Register undo/redo keyboard shortcuts.
 *
 * Shortcuts registered:
 * - `mod+z` - Undo last action
 * - `mod+shift+z` - Redo last undone action
 * - `mod+alt+z` - Open history panel (optional)
 *
 * @param callbacks - Functions to call when shortcuts are triggered
 * @returns Cleanup function to unregister shortcuts
 *
 * @example
 * ```typescript
 * const cleanup = registerUndoShortcuts({
 *   onUndo: () => performUndo(),
 *   onRedo: () => performRedo(),
 *   onOpenHistory: () => setHistoryOpen(true),
 * });
 *
 * // Later, to clean up:
 * cleanup();
 * ```
 */
export function registerUndoShortcuts(callbacks: UndoShortcutCallbacks): () => void {
  const manager = getShortcutManager();
  const unregisterFns: (() => void)[] = [];

  // Undo: Cmd+Z / Ctrl+Z
  unregisterFns.push(
    manager.register(
      {
        id: 'undo',
        keys: 'mod+z',
        scope: 'global',
        allowInInput: false,
      },
      () => {
        void callbacks.onUndo();
      },
    ),
  );

  // Redo: Cmd+Shift+Z / Ctrl+Shift+Z
  unregisterFns.push(
    manager.register(
      {
        id: 'redo',
        keys: 'mod+shift+z',
        scope: 'global',
        allowInInput: false,
      },
      () => {
        void callbacks.onRedo();
      },
    ),
  );

  // Open history panel: Cmd+Alt+Z / Ctrl+Alt+Z (optional)
  if (callbacks.onOpenHistory) {
    unregisterFns.push(
      manager.register(
        {
          id: 'open-history',
          keys: 'mod+alt+z',
          scope: 'global',
          allowInInput: false,
        },
        callbacks.onOpenHistory,
      ),
    );
  }

  // Return cleanup function
  return () => {
    for (const unregister of unregisterFns) {
      unregister();
    }
  };
}
