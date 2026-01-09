/**
 * Action registration for command palette.
 *
 * This module exports all available actions and provides a function to
 * register them with the action registry. Call `registerAllActions()`
 * once at app startup to make all actions available in the palette.
 *
 * ## Action Categories
 *
 * | Category | Description | Example Actions |
 * |----------|-------------|-----------------|
 * | navigation | Go to pages | Go to Dashboard, Go to Tasks |
 * | create | Create entities | Create Task, Create Project |
 * | entity | Actions on selected | Edit Task, Delete Task |
 * | time | Time tracking | Start Timer, Stop Timer |
 * | search | Search features | Search Everything |
 * | settings | Preferences | Toggle Theme |
 * | ai | AI features | Ask Athena |
 *
 * ## Registration
 *
 * Actions are registered in priority order within their category.
 * Higher priority actions appear first when browsing without a search query.
 *
 * ```typescript
 * // In your app initialization
 * import { registerAllActions } from '@/lib/command-palette/actions';
 *
 * // Register all actions at startup
 * registerAllActions();
 * ```
 *
 * ## Custom Actions
 *
 * To add custom actions, either:
 * 1. Add them to the appropriate file in this directory
 * 2. Register them directly with the registry:
 *
 * ```typescript
 * import { getActionRegistry } from '@/lib/command-palette';
 *
 * const registry = getActionRegistry();
 * registry.register(myCustomAction);
 * ```
 *
 * @packageDocumentation
 */

import { getActionRegistry, getShortcutManager } from '@/lib/command-palette';

// Action modules
import { navigationActions } from './navigation';
import { taskActions } from './tasks';
import { timeActions } from './time';
import { undoActions } from './undo';

/**
 * All actions to register.
 *
 * Combines actions from all modules. Order doesn't matter here since
 * actions are sorted by priority within the registry.
 */
const allActions = [...navigationActions, ...taskActions, ...timeActions, ...undoActions];

/**
 * Register all actions with the registry.
 *
 * Should be called once at app startup. Safe to call multiple times -
 * duplicate registrations will log a warning but not break anything.
 *
 * Also registers keyboard shortcuts for actions that have them defined.
 *
 * @example
 * // In CommandPaletteProvider or app initialization
 * useEffect(() => {
 *   registerAllActions();
 * }, []);
 */
export function registerAllActions(): void {
  const registry = getActionRegistry();
  const shortcutManager = getShortcutManager();

  for (const action of allActions) {
    // Register with action registry
    registry.register(action);

    // Register keyboard shortcut if defined
    if (action.type === 'action' && action.shortcut) {
      shortcutManager.register(action.shortcut, () => {
        // When shortcut is triggered, we need to execute the action
        // For now, just log - full integration requires access to context
        console.log(`[Shortcut] Triggered: ${action.id}`);
        // TODO: Execute action with current context
      });
    }
  }

  console.log(`[ActionRegistry] Registered ${String(allActions.length)} actions`);
}

// Re-export individual action groups for selective use
export { navigationActions } from './navigation';
export { taskActions, createTaskAction } from './tasks';
export { timeActions } from './time';
export { undoActions } from './undo';
