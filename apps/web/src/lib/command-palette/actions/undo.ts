/**
 * Undo/Redo actions for command palette.
 *
 * These actions provide command palette access to the undo/redo system.
 * The actual undo/redo operations are performed via keyboard shortcuts
 * (Cmd+Z / Cmd+Shift+Z), but these actions allow discovery and use
 * via the command palette.
 *
 * ## Available Actions
 *
 * | Action | Shortcut | Description |
 * |--------|----------|-------------|
 * | Undo | `mod+z` | Undo last action |
 * | Redo | `mod+shift+z` | Redo last undone action |
 * | View History | `mod+alt+z` | Open action history panel |
 *
 * @packageDocumentation
 */

import { Undo2, Redo2, History } from 'lucide-react';
import type { ExecutableAction } from '../types';
import { getUndoState } from '@/lib/undo';

const isMacPlatform = (): boolean => {
  if (typeof navigator === 'undefined') {
    return false;
  }
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
};

/**
 * Undo last action.
 *
 * This action is a proxy for the keyboard shortcut - the actual undo
 * is performed by the UndoProvider's shortcut handler.
 */
export const undoAction: ExecutableAction = {
  type: 'action',
  id: 'undo',
  label: 'Undo',
  icon: Undo2,
  category: 'settings',
  keywords: ['back', 'reverse', 'cancel', 'ctrl z', 'cmd z'],
  priority: 100,
  isAvailable: (): boolean | string => {
    const state = getUndoState();
    if (!state.canUndo()) {
      return 'Nothing to undo';
    }
    return true;
  },
  execute: (): Promise<{ success: boolean; message?: string }> => {
    // The actual undo is triggered via keyboard event simulation
    // or by calling the undo store directly
    const state = getUndoState();
    if (!state.canUndo()) {
      return Promise.resolve({ success: false, message: 'Nothing to undo' });
    }

    // Dispatch keyboard event to trigger the shortcut handler
    const isMac = isMacPlatform();
    const event = new KeyboardEvent('keydown', {
      key: 'z',
      metaKey: isMac,
      ctrlKey: !isMac,
      bubbles: true,
    });
    document.dispatchEvent(event);

    return Promise.resolve({ success: true });
  },
};

/**
 * Redo last undone action.
 */
export const redoAction: ExecutableAction = {
  type: 'action',
  id: 'redo',
  label: 'Redo',
  icon: Redo2,
  category: 'settings',
  keywords: ['forward', 'repeat', 'again', 'ctrl shift z', 'cmd shift z'],
  priority: 99,
  isAvailable: (): boolean | string => {
    const state = getUndoState();
    if (!state.canRedo()) {
      return 'Nothing to redo';
    }
    return true;
  },
  execute: (): Promise<{ success: boolean; message?: string }> => {
    const state = getUndoState();
    if (!state.canRedo()) {
      return Promise.resolve({ success: false, message: 'Nothing to redo' });
    }

    // Dispatch keyboard event to trigger the shortcut handler
    const isMac = isMacPlatform();
    const event = new KeyboardEvent('keydown', {
      key: 'z',
      shiftKey: true,
      metaKey: isMac,
      ctrlKey: !isMac,
      bubbles: true,
    });
    document.dispatchEvent(event);

    return Promise.resolve({ success: true });
  },
};

/**
 * Open action history panel.
 */
export const viewHistoryAction: ExecutableAction = {
  type: 'action',
  id: 'view-history',
  label: 'View History',
  icon: History,
  category: 'settings',
  keywords: ['actions', 'changes', 'log', 'undo list'],
  priority: 98,
  execute: (): Promise<{ success: boolean; message?: string }> => {
    // Dispatch keyboard event to trigger the history panel
    const isMac = isMacPlatform();
    const event = new KeyboardEvent('keydown', {
      key: 'z',
      altKey: true,
      metaKey: isMac,
      ctrlKey: !isMac,
      bubbles: true,
    });
    document.dispatchEvent(event);

    return Promise.resolve({ success: true });
  },
};

/**
 * All undo-related actions.
 */
export const undoActions: ExecutableAction[] = [undoAction, redoAction, viewHistoryAction];
