/**
 * Action registry for command palette.
 *
 * This module provides a centralized registry for all actions that can be
 * executed from the command palette. Think of it as a "phone book" for actions -
 * when a user searches or navigates the palette, the registry is queried to find
 * matching actions.
 *
 * ## Architecture
 *
 * The registry follows a singleton pattern - there's one global instance that
 * all parts of the application share. This ensures consistency: when one component
 * registers an action, it's immediately available everywhere.
 *
 * ```
 * ┌──────────────────────────────────────────────────────────────────┐
 * │                        ActionRegistry                           │
 * │                                                                  │
 * │  ┌─────────────────────────────────────────────────────────────┐ │
 * │  │                    actions: Map<id, Action>                 │ │
 * │  │                                                             │ │
 * │  │  'go-dashboard' → { type: 'action', label: 'Dashboard'... } │ │
 * │  │  'tasks'        → { type: 'group', children: [...] }        │ │
 * │  │  'create-task'  → { type: 'action', form: {...} }           │ │
 * │  │  ...                                                        │ │
 * │  └─────────────────────────────────────────────────────────────┘ │
 * │                                                                  │
 * │  register(action)  ─── Adds action to map                       │
 * │  unregister(id)    ─── Removes action from map                  │
 * │  getAvailable()    ─── Filters by context + query               │
 * │  getByCategory()   ─── Groups actions by category               │
 * └──────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Registration
 *
 * Actions are typically registered at app startup. Each action must have a
 * unique ID. Registering an action with the same ID replaces the previous one.
 *
 * ```typescript
 * import { getActionRegistry } from './registry';
 *
 * const registry = getActionRegistry();
 *
 * // Register a simple navigation action
 * registry.register({
 *   type: 'action',
 *   id: 'go-dashboard',
 *   label: 'Go to Dashboard',
 *   icon: LayoutDashboard,
 *   category: 'navigation',
 *   execute: async () => {
 *     router.push('/dashboard');
 *     return { success: true };
 *   },
 * });
 *
 * // Register a group with nested actions
 * registry.register({
 *   type: 'group',
 *   id: 'tasks',
 *   label: 'Tasks',
 *   icon: CheckSquare,
 *   category: 'create',
 *   children: [createTaskAction, editTaskAction, deleteTaskAction],
 * });
 * ```
 *
 * ## Querying
 *
 * When the user opens the palette or types a search query, the registry is
 * queried to find relevant actions:
 *
 * ```typescript
 * // Get all available actions (for empty palette)
 * const actions = registry.getAvailableActions(context, '');
 *
 * // Search for actions matching "create"
 * const matches = registry.getAvailableActions(context, 'create');
 *
 * // Get all navigation actions
 * const navActions = registry.getActionsByCategory('navigation');
 * ```
 *
 * ## Context-Aware Filtering
 *
 * Actions can define an `isAvailable` function that determines whether they
 * should appear in a given context. For example, "Edit Task" should only
 * appear when viewing a task:
 *
 * ```typescript
 * const editTaskAction: ExecutableAction = {
 *   // ...
 *   isAvailable: (ctx) => {
 *     if (ctx.entity?.type !== 'task') {
 *       return false; // Hide completely
 *     }
 *     return true;
 *   },
 * };
 * ```
 *
 * ## Integration with Fuzzy Search
 *
 * The registry doesn't do fuzzy searching itself - that's handled by the
 * fuzzy-search module. The registry's job is to:
 * 1. Store all registered actions
 * 2. Filter out unavailable actions based on context
 * 3. Hand off the filtered list to fuzzy search for matching and ranking
 *
 * @packageDocumentation
 */

import type {
  Action,
  ActionCategory,
  ActionRegistry,
  CommandContext,
  ExecutableAction,
  ActionGroup,
} from './types';
import { fuzzySearch } from './fuzzy-search';

/**
 * Check if an action is available in the given context.
 *
 * This function evaluates an action's `isAvailable` predicate (if defined)
 * against the current context. Actions without an `isAvailable` function
 * are always available.
 *
 * @param action - The action to check availability for
 * @param context - Current command context (route, entity, workspace, etc.)
 * @returns Object indicating availability and optional reason for being disabled
 *
 * @example
 * // Action is available (no predicate defined)
 * checkActionAvailability({ type: 'action', ... }, context)
 * // Returns: { available: true }
 *
 * @example
 * // Action is hidden (predicate returns false)
 * checkActionAvailability({
 *   isAvailable: (ctx) => ctx.entity?.type === 'task'
 * }, { entity: null, ... })
 * // Returns: { available: false }
 *
 * @example
 * // Action is disabled with reason (predicate returns string)
 * checkActionAvailability({
 *   isAvailable: (ctx) => ctx.timer ? true : 'No timer running'
 * }, { timer: null, ... })
 * // Returns: { available: true, reason: 'No timer running' }
 */
function checkActionAvailability(
  action: Action,
  context: CommandContext,
): { available: boolean; reason?: string } {
  // If no isAvailable function, action is always available
  if (!action.isAvailable) {
    return { available: true };
  }

  const result = action.isAvailable(context);

  // Boolean true means fully available
  if (result === true) {
    return { available: true };
  }

  // Boolean false means hidden (not shown at all)
  if (result === false) {
    return { available: false };
  }

  // String means shown but disabled, with the string as the reason
  // Example: "Select a task first" or "Timer already running"
  return { available: true, reason: result };
}

/**
 * Recursively collect all action IDs from an action tree.
 *
 * This is used to check for duplicate IDs when registering actions.
 * Groups can contain nested actions, so we need to traverse the tree.
 *
 * @param action - The action or group to collect IDs from
 * @returns Array of all action IDs found (including nested children)
 *
 * @example
 * collectActionIds({
 *   type: 'group',
 *   id: 'tasks',
 *   children: [
 *     { type: 'action', id: 'create-task', ... },
 *     { type: 'action', id: 'edit-task', ... },
 *   ],
 * })
 * // Returns: ['tasks', 'create-task', 'edit-task']
 */
function collectActionIds(action: Action): string[] {
  const ids = [action.id];

  if (action.type === 'group') {
    for (const child of action.children) {
      ids.push(...collectActionIds(child));
    }
  }

  return ids;
}

/**
 * Create a new action registry instance.
 *
 * The registry manages the lifecycle of all command palette actions:
 * - **Registration**: Actions are added with `register()` and removed with `unregister()`
 * - **Querying**: Actions are retrieved with `getAvailableActions()` or `getActionsByCategory()`
 * - **Filtering**: Actions are automatically filtered based on context and search query
 *
 * ## How Registration Works
 *
 * When you call `register(action)`:
 * 1. The action is stored in an internal Map keyed by its ID
 * 2. If the action is a group, its children are NOT registered separately -
 *    they remain nested within the group
 * 3. If an action with the same ID already exists, it's replaced (with a warning)
 *
 * ## How Querying Works
 *
 * When you call `getAvailableActions(context, query)`:
 * 1. All top-level actions are checked against `isAvailable(context)`
 * 2. Unavailable actions (those returning `false`) are filtered out
 * 3. The remaining actions are passed to fuzzy search for matching and ranking
 * 4. Matched actions are sorted by relevance score
 *
 * ## Memory Management
 *
 * Actions registered dynamically (e.g., from a loaded plugin) should be
 * unregistered when no longer needed to prevent memory leaks. Core actions
 * registered at app startup typically don't need cleanup.
 *
 * @returns A new ActionRegistry instance with empty action map
 *
 * @example
 * const registry = createActionRegistry();
 *
 * // Register actions
 * registry.register(goToDashboardAction);
 * registry.register(createTaskAction);
 *
 * // Query actions
 * const all = registry.getAvailableActions(context, '');
 * const filtered = registry.getAvailableActions(context, 'dashboard');
 *
 * // Get by category
 * const navActions = registry.getActionsByCategory('navigation');
 */
export function createActionRegistry(): ActionRegistry {
  /**
   * Internal storage for registered actions.
   * Key is the action ID, value is the action itself.
   */
  const actions = new Map<string, Action>();

  return {
    /**
     * The internal actions map.
     * Exposed for advanced use cases like iterating all actions.
     * Prefer using the query methods for most use cases.
     */
    actions,

    /**
     * Register an action with the registry.
     *
     * The action becomes immediately available for querying. If an action
     * with the same ID already exists, it will be replaced with a console
     * warning.
     *
     * ## Important Notes
     *
     * - Action IDs must be unique across the entire registry
     * - Groups and their children share the same namespace
     * - Registering a group does NOT auto-register its children as top-level actions
     *
     * @param action - The action or action group to register
     *
     * @example
     * // Register a simple action
     * registry.register({
     *   type: 'action',
     *   id: 'toggle-theme',
     *   label: 'Toggle Dark Mode',
     *   icon: Moon,
     *   category: 'settings',
     *   execute: async () => {
     *     toggleTheme();
     *     return { success: true };
     *   },
     * });
     *
     * @example
     * // Register a group with children
     * registry.register({
     *   type: 'group',
     *   id: 'project-actions',
     *   label: 'Project',
     *   icon: FolderKanban,
     *   category: 'entity',
     *   children: [
     *     createProjectAction,
     *     archiveProjectAction,
     *     deleteProjectAction,
     *   ],
     * });
     */
    register(action: Action): void {
      // Check for duplicate IDs
      if (actions.has(action.id)) {
        console.warn(
          `[ActionRegistry] Action with ID "${action.id}" already exists and will be replaced.`,
        );
      }

      // Warn about nested duplicate IDs
      if (action.type === 'group') {
        const childIds = collectActionIds(action);
        const duplicates = childIds.filter((id, index) => childIds.indexOf(id) !== index);
        if (duplicates.length > 0) {
          console.warn(
            `[ActionRegistry] Group "${action.id}" contains duplicate IDs: ${duplicates.join(', ')}`,
          );
        }
      }

      actions.set(action.id, action);
    },

    /**
     * Remove an action from the registry by its ID.
     *
     * After unregistration, the action will no longer appear in query results.
     * If the ID doesn't exist, this is a no-op (no error thrown).
     *
     * ## When to Unregister
     *
     * - When a plugin or feature is unloaded
     * - When a context-specific action set changes (e.g., leaving a workspace)
     * - During cleanup in tests
     *
     * @param actionId - The unique ID of the action to remove
     *
     * @example
     * // Register temporarily
     * registry.register(tempAction);
     *
     * // Later, remove it
     * registry.unregister('temp-action-id');
     */
    unregister(actionId: string): void {
      actions.delete(actionId);
    },

    /**
     * Get all actions available in the current context, filtered by query.
     *
     * This is the primary method for populating the command palette. It:
     * 1. Filters out actions that are unavailable in the context
     * 2. Applies fuzzy search to match and rank results
     * 3. Returns sorted results with match metadata
     *
     * ## Empty Query Behavior
     *
     * When `query` is empty, all available actions are returned sorted by
     * their priority (higher priority first). This is what you'd see when
     * first opening the palette.
     *
     * ## Search Behavior
     *
     * When `query` is provided, actions are scored based on how well their
     * label and keywords match. See `fuzzy-search.ts` for scoring details.
     * Groups are flattened during search - their children are matched directly.
     *
     * @param context - Current command context for availability filtering
     * @param query - Search query (empty string returns all available actions)
     * @returns Array of available actions, sorted by relevance
     *
     * @example
     * // Get all actions for empty palette
     * const actions = registry.getAvailableActions(context, '');
     * // Returns all available actions sorted by priority
     *
     * @example
     * // Search for task-related actions
     * const matches = registry.getAvailableActions(context, 'task');
     * // Returns actions matching "task" sorted by relevance score
     *
     * @example
     * // Context-aware filtering
     * const context = { entity: { type: 'task', id: '123', data: task } };
     * const actions = registry.getAvailableActions(context, '');
     * // "Edit Task" and "Delete Task" will appear because entity is a task
     */
    getAvailableActions(context: CommandContext, query: string): Action[] {
      // Collect all top-level actions that are available in this context
      const availableActions: Action[] = [];

      for (const [, action] of actions) {
        const { available } = checkActionAvailability(action, context);
        if (available) {
          availableActions.push(action);
        }
      }

      // Use fuzzy search to filter and sort
      // This handles both empty query (returns all) and search query (filters and scores)
      const matches = fuzzySearch(availableActions, query, context);

      // Return just the actions, not the match metadata
      // The UI components will call fuzzySearch directly if they need match ranges
      return matches.map((match) => match.action);
    },

    /**
     * Get a specific action by its ID.
     *
     * This performs a direct lookup in the action map. It does NOT search
     * within groups - only top-level actions are returned.
     *
     * ## Finding Nested Actions
     *
     * If you need to find an action nested within a group, you'll need to
     * traverse the group's children manually, or use `getAvailableActions`
     * with a search query that matches the nested action's label.
     *
     * @param actionId - The unique ID of the action to retrieve
     * @returns The action if found, undefined otherwise
     *
     * @example
     * const action = registry.getAction('create-task');
     * if (action && action.type === 'action') {
     *   await action.execute({ context, formData: null });
     * }
     */
    getAction(actionId: string): Action | undefined {
      return actions.get(actionId);
    },

    /**
     * Get all actions in a specific category.
     *
     * Categories group related actions together (e.g., all navigation actions,
     * all create actions). This is useful for building category-based navigation
     * in the palette.
     *
     * ## Categories
     *
     * - `navigation` - Go to pages (Dashboard, Tasks, Projects, etc.)
     * - `create` - Create new entities (Task, Project, Event, etc.)
     * - `entity` - Actions on selected entity (Edit, Delete, Archive)
     * - `search` - Search/filter actions
     * - `time` - Time tracking (Start Timer, Stop Timer, Log Time)
     * - `settings` - Preferences and settings
     * - `ai` - AI-powered features
     *
     * @param category - The category to filter by
     * @returns Array of actions in that category (not filtered by context)
     *
     * @example
     * // Build a "Create" submenu
     * const createActions = registry.getActionsByCategory('create');
     * // Returns: Create Task, Create Project, Create Event, etc.
     *
     * @example
     * // Show navigation options
     * const navActions = registry.getActionsByCategory('navigation');
     * // Returns: Go to Dashboard, Go to Tasks, Go to Projects, etc.
     */
    getActionsByCategory(category: ActionCategory): Action[] {
      const result: Action[] = [];

      for (const [, action] of actions) {
        if (action.category === category) {
          result.push(action);
        }
      }

      // Sort by priority (higher first) for consistent ordering
      return result.sort((a, b) => {
        const priorityA = a.type === 'action' ? (a.priority ?? 0) : 0;
        const priorityB = b.type === 'action' ? (b.priority ?? 0) : 0;
        return priorityB - priorityA;
      });
    },
  };
}

/**
 * Singleton action registry instance.
 *
 * Lazily initialized on first access via `getActionRegistry()`.
 */
let registryInstance: ActionRegistry | null = null;

/**
 * Get the global action registry singleton.
 *
 * This is the primary way to access the action registry throughout the app.
 * The singleton is lazily created on first access and reused thereafter.
 *
 * ## Why a Singleton?
 *
 * The action registry needs to be globally accessible because:
 * 1. Actions are registered from multiple places (feature modules, plugins)
 * 2. The command palette needs to query all registered actions
 * 3. Keyboard shortcuts need to look up actions by ID
 *
 * Using a singleton ensures all parts of the app see the same set of actions.
 *
 * ## Testing
 *
 * For tests, you may want to reset the registry between test cases.
 * Use `resetActionRegistry()` to clear the singleton and create a fresh instance.
 *
 * @returns The global ActionRegistry instance
 *
 * @example
 * // In a feature module
 * import { getActionRegistry } from '@/lib/command-palette/registry';
 *
 * const registry = getActionRegistry();
 * registry.register(myFeatureAction);
 *
 * @example
 * // In the command palette component
 * const registry = getActionRegistry();
 * const actions = registry.getAvailableActions(context, searchQuery);
 */
export function getActionRegistry(): ActionRegistry {
  registryInstance ??= createActionRegistry();
  return registryInstance;
}

/**
 * Reset the action registry singleton.
 *
 * This clears the current registry instance, causing `getActionRegistry()`
 * to create a new empty registry on next call. Primarily useful for:
 *
 * - **Testing**: Ensuring tests start with a clean slate
 * - **Hot reloading**: Clearing stale actions during development
 *
 * ## Warning
 *
 * After calling this, all previously registered actions are lost.
 * Any code holding a reference to the old registry will have stale data.
 *
 * @example
 * // In a test setup file
 * beforeEach(() => {
 *   resetActionRegistry();
 * });
 *
 * @example
 * // In a test
 * test('registers action correctly', () => {
 *   resetActionRegistry();
 *   const registry = getActionRegistry();
 *   registry.register(testAction);
 *   expect(registry.getAction('test-action')).toBeDefined();
 * });
 */
export function resetActionRegistry(): void {
  registryInstance = null;
}

/**
 * Type helper for finding actions within groups.
 *
 * Recursively searches a group's children for an action with the given ID.
 * This is useful when you need to find a specific action that's nested
 * inside a group structure.
 *
 * @param group - The action group to search within
 * @param actionId - The ID of the action to find
 * @returns The found action or undefined if not found
 *
 * @example
 * const tasksGroup = registry.getAction('tasks') as ActionGroup;
 * const createTask = findActionInGroup(tasksGroup, 'create-task');
 * if (createTask?.type === 'action') {
 *   // Found it!
 * }
 */
export function findActionInGroup(group: ActionGroup, actionId: string): Action | undefined {
  for (const child of group.children) {
    if (child.id === actionId) {
      return child;
    }

    // Recurse into nested groups
    if (child.type === 'group') {
      const found = findActionInGroup(child, actionId);
      if (found) {
        return found;
      }
    }
  }

  return undefined;
}

/**
 * Flatten all executable actions from a tree of actions.
 *
 * This extracts all `ExecutableAction` items from a mixed tree of actions
 * and groups, ignoring the group structure. Useful for:
 *
 * - Building a flat list of all available actions
 * - Registering keyboard shortcuts for all actions
 * - Searching across all actions regardless of nesting
 *
 * @param actions - Array of actions (may include groups)
 * @returns Flat array of all executable actions
 *
 * @example
 * const allActions = flattenActions([
 *   simpleAction,
 *   groupWithChildren,
 *   anotherGroup,
 * ]);
 * // Returns all ExecutableAction items, including those nested in groups
 *
 * @example
 * // Register shortcuts for all actions
 * const registry = getActionRegistry();
 * const allActions = flattenActions([...registry.actions.values()]);
 * for (const action of allActions) {
 *   if (action.shortcut) {
 *     shortcutManager.register(action.shortcut, () => executeAction(action));
 *   }
 * }
 */
export function flattenActions(actions: Action[]): ExecutableAction[] {
  const result: ExecutableAction[] = [];

  for (const action of actions) {
    if (action.type === 'action') {
      result.push(action);
    } else {
      // Recursively flatten group children
      result.push(...flattenActions(action.children));
    }
  }

  return result;
}
