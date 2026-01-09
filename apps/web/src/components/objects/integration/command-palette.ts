/**
 * Command Palette Integration for Object System
 *
 * Bridges the object system's selection and actions with the
 * existing command palette infrastructure.
 */

import { CheckCircle, Circle, Copy, Link, Trash2, Calendar, FolderInput } from 'lucide-react';
import type { ExecutableAction, ActionGroup, CommandContext } from '@/lib/command-palette';
import { getActionRegistry } from '@/lib/command-palette';
import type { AnyObject, ObjectType } from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Extended context with selection state.
 * This adds selection information to the standard CommandContext.
 */
export interface ObjectSelectionContext {
  /** IDs of selected objects */
  selectedIds: string[];
  /** Full objects if available */
  selectedObjects: AnyObject[];
  /** Types of selected objects (for filtering applicable actions) */
  selectedTypes: ObjectType[];
}

/**
 * Factory function to get current selection.
 * This is injected to avoid tight coupling with the context provider.
 */
export type SelectionGetter = () => ObjectSelectionContext;

// =============================================================================
// Action Factories
// =============================================================================

/**
 * Create selection-aware delete action.
 */
function createDeleteAction(getSelection: SelectionGetter): ExecutableAction {
  return {
    type: 'action',
    id: 'object-delete',
    label: 'Delete',
    icon: Trash2,
    category: 'entity',
    keywords: ['remove', 'trash', 'destroy'],
    priority: -100, // Lower priority (dangerous action)

    isAvailable: (_ctx: CommandContext) => {
      const selection = getSelection();
      if (selection.selectedIds.length === 0) {
        return false;
      }
      return true;
    },

    execute: () => {
      const selection = getSelection();
      if (selection.selectedIds.length === 0) {
        return Promise.resolve({ success: false, message: 'No objects selected' });
      }

      // TODO: Call actual delete API
      console.log('[ObjectSystem] Delete:', selection.selectedIds);

      return Promise.resolve({
        success: true,
        message: `Deleted ${String(selection.selectedIds.length)} item(s)`,
        invalidate: ['tasks', 'events', 'projects'],
      });
    },
  };
}

/**
 * Create selection-aware duplicate action.
 */
function createDuplicateAction(getSelection: SelectionGetter): ExecutableAction {
  return {
    type: 'action',
    id: 'object-duplicate',
    label: 'Duplicate',
    icon: Copy,
    category: 'entity',
    keywords: ['copy', 'clone'],
    priority: 50,

    isAvailable: (_ctx: CommandContext) => {
      const selection = getSelection();
      if (selection.selectedIds.length === 0) {
        return false;
      }
      return true;
    },

    execute: () => {
      const selection = getSelection();
      if (selection.selectedIds.length === 0) {
        return Promise.resolve({ success: false, message: 'No objects selected' });
      }

      // TODO: Call actual duplicate API
      console.log('[ObjectSystem] Duplicate:', selection.selectedIds);

      return Promise.resolve({
        success: true,
        message: `Duplicated ${String(selection.selectedIds.length)} item(s)`,
        invalidate: ['tasks', 'events', 'projects'],
      });
    },
  };
}

/**
 * Create copy link action.
 */
function createCopyLinkAction(getSelection: SelectionGetter): ExecutableAction {
  return {
    type: 'action',
    id: 'object-copy-link',
    label: 'Copy Link',
    icon: Link,
    category: 'entity',
    keywords: ['share', 'url'],
    priority: 40,

    isAvailable: (_ctx: CommandContext) => {
      const selection = getSelection();
      // Only available for single selection
      return selection.selectedIds.length === 1;
    },

    execute: async () => {
      const selection = getSelection();
      if (selection.selectedIds.length !== 1 || !selection.selectedObjects[0]) {
        return { success: false, message: 'Select exactly one item' };
      }

      const obj = selection.selectedObjects[0];
      const url = `${window.location.origin}/${obj.type}s/${obj.id}`;
      await navigator.clipboard.writeText(url);

      return {
        success: true,
        message: 'Link copied to clipboard',
      };
    },
  };
}

/**
 * Create task complete action.
 */
function createCompleteAction(getSelection: SelectionGetter): ExecutableAction {
  return {
    type: 'action',
    id: 'object-complete',
    label: 'Mark Complete',
    icon: CheckCircle,
    category: 'entity',
    keywords: ['done', 'finish', 'check'],
    priority: 100,

    isAvailable: (_ctx: CommandContext) => {
      const selection = getSelection();
      // Only for tasks
      const hasTasks = selection.selectedTypes.some((t) => t === 'task');
      if (!hasTasks) {
        return false;
      }
      return true;
    },

    execute: () => {
      const selection = getSelection();
      const taskIds = selection.selectedObjects.filter((o) => o.type === 'task').map((o) => o.id);

      if (taskIds.length === 0) {
        return Promise.resolve({ success: false, message: 'No tasks selected' });
      }

      // TODO: Call actual complete API
      console.log('[ObjectSystem] Complete tasks:', taskIds);

      return Promise.resolve({
        success: true,
        message: `Completed ${String(taskIds.length)} task(s)`,
        invalidate: ['tasks'],
      });
    },
  };
}

/**
 * Create task uncomplete action.
 */
function createUncompleteAction(getSelection: SelectionGetter): ExecutableAction {
  return {
    type: 'action',
    id: 'object-uncomplete',
    label: 'Mark Incomplete',
    icon: Circle,
    category: 'entity',
    keywords: ['undo', 'reopen', 'uncheck'],
    priority: 90,

    isAvailable: (_ctx: CommandContext) => {
      const selection = getSelection();
      // Only for tasks
      const hasTasks = selection.selectedTypes.some((t) => t === 'task');
      if (!hasTasks) {
        return false;
      }
      return true;
    },

    execute: () => {
      const selection = getSelection();
      const taskIds = selection.selectedObjects.filter((o) => o.type === 'task').map((o) => o.id);

      if (taskIds.length === 0) {
        return Promise.resolve({ success: false, message: 'No tasks selected' });
      }

      // TODO: Call actual uncomplete API
      console.log('[ObjectSystem] Uncomplete tasks:', taskIds);

      return Promise.resolve({
        success: true,
        message: `Reopened ${String(taskIds.length)} task(s)`,
        invalidate: ['tasks'],
      });
    },
  };
}

/**
 * Create schedule action.
 */
function createScheduleAction(getSelection: SelectionGetter): ExecutableAction {
  return {
    type: 'action',
    id: 'object-schedule',
    label: 'Schedule...',
    icon: Calendar,
    category: 'entity',
    keywords: ['calendar', 'time', 'block'],
    priority: 80,

    isAvailable: (_ctx: CommandContext) => {
      const selection = getSelection();
      // Only for tasks
      const hasTasks = selection.selectedTypes.some((t) => t === 'task');
      if (!hasTasks) {
        return false;
      }
      return true;
    },

    execute: () => {
      const selection = getSelection();
      const taskIds = selection.selectedObjects.filter((o) => o.type === 'task').map((o) => o.id);

      if (taskIds.length === 0) {
        return Promise.resolve({ success: false, message: 'No tasks selected' });
      }

      // TODO: Open schedule picker dialog
      console.log('[ObjectSystem] Schedule tasks:', taskIds);

      return Promise.resolve({
        success: true,
        message: 'Opening scheduler...',
      });
    },
  };
}

/**
 * Create move to project action.
 */
function createMoveToProjectAction(getSelection: SelectionGetter): ExecutableAction {
  return {
    type: 'action',
    id: 'object-move-to-project',
    label: 'Move to Project...',
    icon: FolderInput,
    category: 'entity',
    keywords: ['organize', 'folder'],
    priority: 70,

    isAvailable: (_ctx: CommandContext) => {
      const selection = getSelection();
      // Only for tasks
      const hasTasks = selection.selectedTypes.some((t) => t === 'task');
      if (!hasTasks) {
        return false;
      }
      return true;
    },

    execute: () => {
      const selection = getSelection();
      const taskIds = selection.selectedObjects.filter((o) => o.type === 'task').map((o) => o.id);

      if (taskIds.length === 0) {
        return Promise.resolve({ success: false, message: 'No tasks selected' });
      }

      // TODO: Open project picker dialog
      console.log('[ObjectSystem] Move to project:', taskIds);

      return Promise.resolve({
        success: true,
        message: 'Opening project picker...',
      });
    },
  };
}

/**
 * Create the selection actions group.
 */
function createSelectionActionsGroup(getSelection: SelectionGetter): ActionGroup {
  return {
    type: 'group',
    id: 'selection-actions',
    label: 'Selection',
    icon: CheckCircle,
    category: 'entity',
    keywords: ['selected', 'bulk', 'batch'],

    isAvailable: (_ctx: CommandContext) => {
      const selection = getSelection();
      return selection.selectedIds.length > 0;
    },

    children: [
      createCompleteAction(getSelection),
      createUncompleteAction(getSelection),
      createScheduleAction(getSelection),
      createMoveToProjectAction(getSelection),
      createDuplicateAction(getSelection),
      createCopyLinkAction(getSelection),
      createDeleteAction(getSelection),
    ],
  };
}

// =============================================================================
// Registration
// =============================================================================

/**
 * Register object system actions with the command palette.
 *
 * This should be called once during app initialization, providing
 * a function to get the current selection state.
 *
 * @param getSelection - Function to retrieve current selection state
 * @returns Cleanup function to unregister all actions
 *
 * @example
 * ```tsx
 * // In your app layout or provider
 * useEffect(() => {
 *   const cleanup = registerObjectSystemActions(() => ({
 *     selectedIds: [...selection.selected],
 *     selectedObjects: Array.from(selection.selected)
 *       .map(id => registry.getObject(id))
 *       .filter(Boolean),
 *     selectedTypes: [...new Set(selectedObjects.map(o => o.type))],
 *   }));
 *
 *   return cleanup;
 * }, [selection, registry]);
 * ```
 */
export function registerObjectSystemActions(getSelection: SelectionGetter): () => void {
  const registry = getActionRegistry();

  // Create and register the selection actions group
  const selectionGroup = createSelectionActionsGroup(getSelection);
  registry.register(selectionGroup);

  // Also register top-level actions for keyboard shortcuts
  const topLevelActions = [
    createDeleteAction(getSelection),
    createDuplicateAction(getSelection),
    createCompleteAction(getSelection),
  ];

  // Give them different IDs for top-level registration
  topLevelActions.forEach((action, i) => {
    const modifiedAction = {
      ...action,
      id: `${action.id}-global`,
      // Add keyboard shortcuts
      shortcut:
        i === 0
          ? {
              id: `${action.id}-global`,
              keys: 'mod+backspace',
              scope: 'global' as const,
              preventDefault: true,
            }
          : i === 2
            ? {
                id: `${action.id}-global`,
                keys: 'mod+enter',
                scope: 'global' as const,
                preventDefault: true,
              }
            : undefined,
    };
    registry.register(modifiedAction);
  });

  // Return cleanup function
  return () => {
    registry.unregister('selection-actions');
    topLevelActions.forEach((action) => {
      registry.unregister(`${action.id}-global`);
    });
  };
}
