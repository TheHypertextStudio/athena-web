'use client';

/**
 * Action Context
 *
 * Discovers and executes actions based on the current selection.
 * Actions are context-aware and type-sensitive.
 */

import { createContext, useContext, useCallback, useMemo, useState, type ReactNode } from 'react';
import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import LinkOutlined from '@mui/icons-material/LinkOutlined';
import CheckOutlined from '@mui/icons-material/CheckOutlined';
import CalendarTodayOutlined from '@mui/icons-material/CalendarTodayOutlined';
import DriveFileMoveOutlined from '@mui/icons-material/DriveFileMoveOutlined';
import type { AnyObject, Action, ActionGroup } from '../types';
import { useSelection } from './SelectionContext';
import { useObjectRegistry } from './ObjectRegistryContext';
import { isCompletable, isCompleted } from '../types';

// =============================================================================
// Built-in Actions
// =============================================================================

/**
 * Universal actions available for all object types.
 */
const universalActions: Action[] = [
  {
    id: 'delete',
    label: 'Delete',
    icon: DeleteOutlined,
    shortcut: '⌘⌫',
    appliesTo: ['task', 'event', 'project', 'initiative', 'moment', 'activity'],
    isDestructive: true,
    requiresConfirmation: true,
    execute: (objects) => {
      // TODO: Implement delete via API
      console.log(
        'Delete:',
        objects.map((o) => o.id),
      );
    },
  },
  {
    id: 'duplicate',
    label: 'Duplicate',
    icon: ContentCopyOutlined,
    shortcut: '⌘D',
    appliesTo: ['task', 'event', 'project'],
    execute: (objects) => {
      // TODO: Implement duplicate via API
      console.log(
        'Duplicate:',
        objects.map((o) => o.id),
      );
    },
  },
  {
    id: 'copy-link',
    label: 'Copy link',
    icon: LinkOutlined,
    shortcut: '⌘⇧C',
    appliesTo: ['task', 'event', 'project', 'initiative', 'moment', 'activity'],
    execute: async (objects) => {
      if (objects.length === 1 && objects[0]) {
        const obj = objects[0];
        const url = `${window.location.origin}/${obj.type}s/${obj.id}`;
        await navigator.clipboard.writeText(url);
      }
    },
  },
];

/**
 * Actions for completable objects.
 */
const completableActions: Action[] = [
  {
    id: 'complete',
    label: 'Mark complete',
    icon: CheckOutlined,
    shortcut: '⌘⏎',
    appliesTo: ['task', 'project', 'initiative'],
    isAvailable: (objects) => {
      return objects.every((obj) => isCompletable(obj) && !isCompleted(obj));
    },
    execute: (objects) => {
      // TODO: Implement complete via API
      console.log(
        'Complete:',
        objects.map((o) => o.id),
      );
    },
  },
  {
    id: 'uncomplete',
    label: 'Mark incomplete',
    icon: CheckOutlined,
    appliesTo: ['task', 'project', 'initiative'],
    isAvailable: (objects) => {
      return objects.every((obj) => isCompletable(obj) && isCompleted(obj));
    },
    execute: (objects) => {
      // TODO: Implement uncomplete via API
      console.log(
        'Uncomplete:',
        objects.map((o) => o.id),
      );
    },
  },
];

/**
 * Task-specific actions.
 */
const taskActions: Action[] = [
  {
    id: 'schedule',
    label: 'Schedule...',
    icon: CalendarTodayOutlined,
    shortcut: '⌘S',
    appliesTo: ['task'],
    execute: (objects) => {
      // TODO: Open schedule picker
      console.log(
        'Schedule:',
        objects.map((o) => o.id),
      );
    },
  },
  {
    id: 'move-to-project',
    label: 'Move to project...',
    icon: DriveFileMoveOutlined,
    shortcut: '⌘M',
    appliesTo: ['task'],
    execute: (objects) => {
      // TODO: Open project picker
      console.log(
        'Move to project:',
        objects.map((o) => o.id),
      );
    },
  },
];

/**
 * All registered actions.
 */
const allActions: Action[] = [...universalActions, ...completableActions, ...taskActions];

// =============================================================================
// Types
// =============================================================================

interface ActionContextValue {
  /** Get actions available for the current selection */
  getActionsForSelection: () => Action[];

  /** Get actions available for specific objects */
  getActionsForObjects: (objects: AnyObject[]) => Action[];

  /** Execute an action by ID */
  executeAction: (actionId: string, objects: AnyObject[]) => Promise<void>;

  /** Register a custom action */
  registerAction: (action: Action) => void;

  /** Unregister a custom action */
  unregisterAction: (actionId: string) => void;

  /** Get all registered actions */
  allActions: Action[];

  /** Group actions by category */
  getActionGroups: (objects: AnyObject[]) => ActionGroup[];
}

// =============================================================================
// Context
// =============================================================================

const ActionContext = createContext<ActionContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface ActionProviderProps {
  children: ReactNode;
}

export function ActionProvider({ children }: ActionProviderProps) {
  const [customActions, setCustomActions] = useState<Action[]>([]);
  const selection = useSelection();
  const registry = useObjectRegistry();

  const registeredActions = useMemo(() => [...allActions, ...customActions], [customActions]);

  const getActionsForObjects = useCallback(
    (objects: AnyObject[]): Action[] => {
      if (objects.length === 0) {
        return [];
      }

      // Get types of selected objects
      const types = new Set(objects.map((obj) => obj.type));

      return registeredActions.filter((action) => {
        // Check if action applies to all selected types
        const appliesToAll = Array.from(types).every((type) => action.appliesTo.includes(type));

        if (!appliesToAll) {
          return false;
        }

        // Check custom availability
        if (action.isAvailable) {
          return action.isAvailable(objects);
        }

        return true;
      });
    },
    [registeredActions],
  );

  const getActionsForSelection = useCallback((): Action[] => {
    const selectedObjects = selection.selectedIds
      .map((id) => registry.getObject(id))
      .filter((obj): obj is AnyObject => obj !== undefined);

    return getActionsForObjects(selectedObjects);
  }, [selection.selectedIds, registry, getActionsForObjects]);

  const executeAction = useCallback(
    async (actionId: string, objects: AnyObject[]) => {
      const action = registeredActions.find((a) => a.id === actionId);
      if (!action) {
        console.error(`Action not found: ${actionId}`);
        return;
      }

      // TODO: Show confirmation dialog if requiresConfirmation
      if (action.requiresConfirmation) {
        // For now, just execute
        console.log('Would confirm:', action.label);
      }

      try {
        await action.execute(objects);
      } catch (error) {
        console.error(`Action failed: ${actionId}`, error);
        // TODO: Show error toast
      }
    },
    [registeredActions],
  );

  const registerAction = useCallback((action: Action) => {
    setCustomActions((prev) => {
      // Replace if exists
      const filtered = prev.filter((a) => a.id !== action.id);
      return [...filtered, action];
    });
  }, []);

  const unregisterAction = useCallback((actionId: string) => {
    setCustomActions((prev) => prev.filter((a) => a.id !== actionId));
  }, []);

  const getActionGroups = useCallback(
    (objects: AnyObject[]): ActionGroup[] => {
      const available = getActionsForObjects(objects);

      // Group by category
      const groups: ActionGroup[] = [];

      // Primary actions (non-destructive)
      const primary = available.filter((a) => !a.isDestructive);
      if (primary.length > 0) {
        groups.push({
          id: 'primary',
          actions: primary,
        });
      }

      // Destructive actions
      const destructive = available.filter((a) => a.isDestructive);
      if (destructive.length > 0) {
        groups.push({
          id: 'destructive',
          label: 'Destructive',
          actions: destructive,
        });
      }

      return groups;
    },
    [getActionsForObjects],
  );

  const value = useMemo(
    (): ActionContextValue => ({
      getActionsForSelection,
      getActionsForObjects,
      executeAction,
      registerAction,
      unregisterAction,
      allActions: registeredActions,
      getActionGroups,
    }),
    [
      getActionsForSelection,
      getActionsForObjects,
      executeAction,
      registerAction,
      unregisterAction,
      registeredActions,
      getActionGroups,
    ],
  );

  return <ActionContext.Provider value={value}>{children}</ActionContext.Provider>;
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Access the action context.
 */
export function useActions(): ActionContextValue {
  const context = useContext(ActionContext);
  if (!context) {
    throw new Error('useActions must be used within an ActionProvider');
  }
  return context;
}

/**
 * Get actions for the current selection.
 */
export function useSelectionActions(): Action[] {
  const { getActionsForSelection } = useActions();
  return useMemo(() => getActionsForSelection(), [getActionsForSelection]);
}

/**
 * Get actions for specific objects.
 */
export function useObjectActions(objects: AnyObject[]): Action[] {
  const { getActionsForObjects } = useActions();
  return useMemo(() => getActionsForObjects(objects), [getActionsForObjects, objects]);
}
