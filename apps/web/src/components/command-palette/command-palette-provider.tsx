/**
 * Command palette provider component.
 *
 * This component wraps the application and provides the command palette context.
 * It handles:
 *
 * 1. **Global keyboard shortcuts** - Cmd+K / Ctrl+K to open palette
 * 2. **Context composition** - Combines route, entity, workspace, timer, and user context
 * 3. **Action registration** - Provides access to the action registry
 * 4. **Palette state management** - Open/close, search query, navigation
 *
 * ## Architecture
 *
 * ```
 * ┌──────────────────────────────────────────────────────────────────┐
 * │                   CommandPaletteProvider                         │
 * │                                                                  │
 * │  ┌────────────────────────────────────────────────────────────┐  │
 * │  │                    Context Sources                          │  │
 * │  │                                                             │  │
 * │  │  usePathname() ──► route                                    │  │
 * │  │  useParams() ────► params                                   │  │
 * │  │  useSelectedEntity() ──► entity                             │  │
 * │  │  useActiveWorkspace() ──► workspace                         │  │
 * │  │  useActiveTimer() ──► timer                                 │  │
 * │  │  useAuth() ──► user                                         │  │
 * │  │                                                             │  │
 * │  └──────────────────────┬─────────────────────────────────────┘  │
 * │                         │                                        │
 * │                         ▼                                        │
 * │  ┌────────────────────────────────────────────────────────────┐  │
 * │  │              CommandContext (merged)                        │  │
 * │  │  { route, params, entity, workspace, timer, user }         │  │
 * │  └──────────────────────┬─────────────────────────────────────┘  │
 * │                         │                                        │
 * │                         ▼                                        │
 * │  ┌────────────────────────────────────────────────────────────┐  │
 * │  │                CommandPaletteContext                        │  │
 * │  │  - isOpen, open(), close(), toggle()                        │  │
 * │  │  - context (CommandContext)                                 │  │
 * │  │  - query, setQuery                                          │  │
 * │  │  - filteredActions                                          │  │
 * │  │  - selectedIndex, navigation                                │  │
 * │  └────────────────────────────────────────────────────────────┘  │
 * │                         │                                        │
 * │                         ▼                                        │
 * │                    {children}                                    │
 * │                         │                                        │
 * │                         ▼                                        │
 * │  ┌────────────────────────────────────────────────────────────┐  │
 * │  │              CommandPalette (Dialog)                        │  │
 * │  │  Rendered as portal, uses context                           │  │
 * │  └────────────────────────────────────────────────────────────┘  │
 * └──────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Usage
 *
 * Wrap your app (or protected routes) with this provider:
 *
 * ```tsx
 * // In apps/web/src/app/(protected)/layout.tsx
 * import { CommandPaletteProvider } from '@/components/command-palette';
 *
 * export default function ProtectedLayout({ children }) {
 *   return (
 *     <CommandPaletteProvider>
 *       {children}
 *     </CommandPaletteProvider>
 *   );
 * }
 * ```
 *
 * ## Keyboard Shortcuts
 *
 * The provider registers these global shortcuts:
 * - `Cmd+K` / `Ctrl+K` - Open/toggle command palette
 * - `Escape` - Close palette (when open)
 *
 * Additional action-specific shortcuts are registered from each action's
 * `shortcut` property.
 *
 * @packageDocumentation
 */

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useParams } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { useSelectedEntity } from '@/hooks/use-selected-entity';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import { useActiveTimer } from '@/hooks/use-active-timer';

import {
  getActionRegistry,
  getShortcutManager,
  fuzzySearch,
  type CommandContext,
  type ExecutableAction,
  type ActionGroup,
  type NavigationItem,
  type FuzzyMatch,
} from '@/lib/command-palette';

const isDefaultValueFactory = (value: unknown): value is (ctx: CommandContext) => unknown =>
  typeof value === 'function';

/**
 * Mode for the command palette.
 *
 * - 'command': Default mode showing action list and search
 * - 'assistant': AI assistant chat mode
 */
export type CommandPaletteMode = 'command' | 'assistant';

/**
 * Command palette context value.
 *
 * This is what components receive when they call `useCommandPalette()`.
 */
interface CommandPaletteContextValue {
  /**
   * Whether the command palette is currently open.
   */
  isOpen: boolean;

  /**
   * Current mode of the command palette.
   */
  mode: CommandPaletteMode;

  /**
   * Open the command palette.
   *
   * If called with an action ID, navigates directly to that action
   * (useful for keyboard shortcuts that trigger specific action groups).
   */
  open: (actionId?: string) => void;

  /**
   * Close the command palette.
   *
   * Resets all state (query, navigation stack, selected index).
   */
  close: () => void;

  /**
   * Toggle the command palette open/closed.
   */
  toggle: () => void;

  /**
   * Current search query.
   */
  query: string;

  /**
   * Update the search query.
   */
  setQuery: (query: string) => void;

  /**
   * Current command context (route, entity, workspace, timer, user).
   *
   * Used by actions to determine availability and pre-fill forms.
   */
  context: CommandContext;

  /**
   * Actions matching the current query, sorted by relevance.
   *
   * When navigation stack has items, this shows the current group's children.
   * Otherwise, shows top-level actions filtered by query.
   */
  filteredActions: FuzzyMatch[];

  /**
   * Currently highlighted item index (for keyboard navigation).
   */
  selectedIndex: number;

  /**
   * Set the selected index (typically via arrow key navigation).
   */
  setSelectedIndex: (index: number) => void;

  /**
   * Navigation stack for nested group navigation.
   *
   * When empty, showing root actions. When populated, showing the
   * last group's children with breadcrumb trail.
   */
  navigationStack: NavigationItem[];

  /**
   * Navigate into a group, pushing it onto the navigation stack.
   */
  pushNavigation: (group: ActionGroup) => void;

  /**
   * Navigate back one level, popping the navigation stack.
   */
  popNavigation: () => void;

  /**
   * Navigate back to root, clearing the navigation stack.
   */
  clearNavigation: () => void;

  /**
   * Currently active action (when showing inline form).
   */
  activeAction: ExecutableAction | null;

  /**
   * Set the active action (enters form mode).
   */
  setActiveAction: (action: ExecutableAction | null) => void;

  /**
   * Current form data for the active action.
   */
  formData: Record<string, unknown>;

  /**
   * Update a field in the form data.
   */
  setFormField: (name: string, value: unknown) => void;

  /**
   * Clear all form data.
   */
  clearFormData: () => void;

  /**
   * Whether an action is currently being executed.
   */
  isExecuting: boolean;

  /**
   * Execute the given action with current form data.
   */
  executeAction: (action: ExecutableAction) => Promise<void>;

  /**
   * Form validation errors keyed by field name.
   */
  formErrors: Record<string, string>;

  /**
   * Enter assistant mode with an optional initial message.
   */
  enterAssistantMode: (initialMessage?: string) => void;

  /**
   * Exit assistant mode and return to command mode.
   */
  exitAssistantMode: () => void;

  /**
   * Initial message to send to assistant (when entering from search).
   */
  assistantInitialMessage: string | null;

  /**
   * Whether we should show the assistant hint (no matching actions).
   */
  shouldShowAssistantHint: boolean;
}

/**
 * React context for command palette state.
 */
const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

/**
 * Props for CommandPaletteProvider.
 */
interface CommandPaletteProviderProps {
  /**
   * Child components that will have access to the command palette.
   */
  children: ReactNode;
}

/**
 * Command palette provider component.
 *
 * Provides command palette context to the entire subtree. Should wrap
 * the protected routes or entire application.
 *
 * @param props - Provider props with children
 *
 * @example
 * // Wrap protected routes
 * function ProtectedLayout({ children }) {
 *   return (
 *     <CommandPaletteProvider>
 *       <Header />
 *       <main>{children}</main>
 *       <CommandPalette />
 *     </CommandPaletteProvider>
 *   );
 * }
 */
export function CommandPaletteProvider({ children }: CommandPaletteProviderProps) {
  // ----- State -----

  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<CommandPaletteMode>('command');
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [navigationStack, setNavigationStack] = useState<NavigationItem[]>([]);
  const [activeAction, setActiveAction] = useState<ExecutableAction | null>(null);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isExecuting, setIsExecuting] = useState(false);
  const [assistantInitialMessage, setAssistantInitialMessage] = useState<string | null>(null);

  // ----- Context Sources -----

  const pathname = usePathname();
  const params = useParams();
  const { user } = useAuth();
  const { entity } = useSelectedEntity();
  const { workspace } = useActiveWorkspace();
  const { timer } = useActiveTimer();

  // ----- Composed Context -----

  /**
   * Compose the full command context from all sources.
   * Memoized to prevent unnecessary recalculations.
   */
  const context = useMemo<CommandContext>(
    () => ({
      route: pathname,
      params: params as Record<string, string>,
      entity,
      workspace,
      timer,
      user: user ? { id: user.id, name: user.name } : null,
    }),
    [pathname, params, entity, workspace, timer, user],
  );

  // ----- Filtered Actions -----

  /**
   * Get the current list of actions based on navigation state and query.
   *
   * - If navigated into a group, search within that group's children
   * - Otherwise, search all top-level actions
   */
  const filteredActions = useMemo<FuzzyMatch[]>(() => {
    const registry = getActionRegistry();

    // If we've navigated into a group, search its children
    if (navigationStack.length > 0) {
      const currentGroup = navigationStack[navigationStack.length - 1];
      if (currentGroup) {
        return fuzzySearch(currentGroup.action.children, query, context);
      }
    }

    // Otherwise, search all top-level actions
    const allActions = registry.getAvailableActions(context, '');
    return fuzzySearch(allActions, query, context);
  }, [navigationStack, query, context]);

  /**
   * Whether to show the assistant hint (no matching actions).
   * Only show if query is long enough and no actions match.
   */
  const shouldShowAssistantHint = useMemo(() => {
    return (
      mode === 'command' &&
      query.length > 2 &&
      filteredActions.length === 0 &&
      navigationStack.length === 0 &&
      !activeAction
    );
  }, [mode, query, filteredActions.length, navigationStack.length, activeAction]);

  // ----- Actions -----

  /**
   * Open the palette, optionally navigating to a specific action.
   */
  const open = useCallback((actionId?: string) => {
    setIsOpen(true);
    setMode('command');
    setQuery('');
    setSelectedIndex(0);
    setNavigationStack([]);
    setActiveAction(null);
    setFormData({});
    setFormErrors({});
    setAssistantInitialMessage(null);

    // If actionId provided, try to navigate to it
    if (actionId) {
      const registry = getActionRegistry();
      const action = registry.getAction(actionId);
      if (action?.type === 'group') {
        setNavigationStack([{ action, query: '' }]);
      }
    }
  }, []);

  /**
   * Close the palette and reset all state.
   */
  const close = useCallback(() => {
    setIsOpen(false);
    setMode('command');
    setQuery('');
    setSelectedIndex(0);
    setNavigationStack([]);
    setActiveAction(null);
    setFormData({});
    setFormErrors({});
    setAssistantInitialMessage(null);
  }, []);

  /**
   * Enter assistant mode with an optional initial message.
   */
  const enterAssistantMode = useCallback((initialMessage?: string) => {
    setMode('assistant');
    setAssistantInitialMessage(initialMessage ?? null);
    setQuery('');
    setSelectedIndex(0);
    setNavigationStack([]);
    setActiveAction(null);
    setFormData({});
    setFormErrors({});
  }, []);

  /**
   * Exit assistant mode and return to command mode.
   */
  const exitAssistantMode = useCallback(() => {
    setMode('command');
    setAssistantInitialMessage(null);
    setQuery('');
    setSelectedIndex(0);
  }, []);

  /**
   * Toggle the palette open/closed.
   */
  const toggle = useCallback(() => {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }, [isOpen, open, close]);

  /**
   * Navigate into a group.
   */
  const pushNavigation = useCallback(
    (group: ActionGroup) => {
      setNavigationStack((stack) => [...stack, { action: group, query }]);
      setQuery('');
      setSelectedIndex(0);
    },
    [query],
  );

  /**
   * Navigate back one level.
   */
  const popNavigation = useCallback(() => {
    setNavigationStack((stack) => {
      const newStack = stack.slice(0, -1);
      // Restore the previous query
      const previousItem = stack[stack.length - 1];
      if (previousItem) {
        setQuery(previousItem.query);
      }
      return newStack;
    });
    setSelectedIndex(0);
  }, []);

  /**
   * Navigate back to root.
   */
  const clearNavigation = useCallback(() => {
    setNavigationStack([]);
    setQuery('');
    setSelectedIndex(0);
  }, []);

  /**
   * Update a form field.
   */
  const setFormField = useCallback((name: string, value: unknown) => {
    setFormData((data) => ({ ...data, [name]: value }));
    // Clear error when field is updated
    setFormErrors((errors) => {
      const { [name]: removed, ...rest } = errors;
      void removed;
      return rest;
    });
  }, []);

  /**
   * Clear all form data.
   */
  const clearFormData = useCallback(() => {
    setFormData({});
    setFormErrors({});
  }, []);

  /**
   * Execute an action.
   */
  const executeAction = useCallback(
    async (action: ExecutableAction) => {
      // If action has a form and we're not in form mode, enter form mode
      if (action.form && !activeAction) {
        setActiveAction(action);

        // Initialize form data with defaults
        const form = typeof action.form === 'function' ? action.form(context) : action.form;
        const initialData: Record<string, unknown> = {};

        for (const field of form.fields) {
          if (field.defaultValue !== undefined) {
            initialData[field.name] = isDefaultValueFactory(field.defaultValue)
              ? field.defaultValue(context)
              : field.defaultValue;
          }
        }

        setFormData(initialData);
        return;
      }

      // Execute the action
      setIsExecuting(true);
      setFormErrors({});

      try {
        const result = await action.execute({
          formData: Object.keys(formData).length > 0 ? formData : null,
          context,
        });

        if (result.success) {
          // Close palette on success
          close();

          // Handle navigation
          if (result.navigateTo) {
            // Use window.location for now - could integrate with router
            window.location.href = result.navigateTo;
          }

          // Handle cache invalidation (would integrate with TanStack Query)
          if (result.invalidate && result.invalidate.length > 0) {
            console.log('[CommandPalette] Would invalidate:', result.invalidate);
            // TODO: Integrate with queryClient.invalidateQueries
          }

          // Show success message (would integrate with toast)
          if (result.message) {
            console.log('[CommandPalette] Success:', result.message);
            // TODO: Integrate with toast notification
          }
        } else {
          // Handle failure
          console.error('[CommandPalette] Action failed:', result.message);
          // TODO: Show error toast
        }
      } catch (error) {
        console.error('[CommandPalette] Action error:', error);
        // TODO: Show error toast
      } finally {
        setIsExecuting(false);
      }
    },
    [activeAction, context, formData, close],
  );

  // ----- Global Keyboard Shortcuts -----

  // Open palette and enter assistant mode
  const openInAssistantMode = useCallback(() => {
    setIsOpen(true);
    setMode('assistant');
    setQuery('');
    setSelectedIndex(0);
    setNavigationStack([]);
    setActiveAction(null);
    setFormData({});
    setFormErrors({});
    setAssistantInitialMessage(null);
  }, []);

  useEffect(() => {
    const shortcutManager = getShortcutManager();

    // Register Cmd+K / Ctrl+K to toggle palette
    const unregisterToggle = shortcutManager.register(
      {
        id: 'toggle-command-palette',
        keys: 'mod+k',
        scope: 'global',
        preventDefault: true,
      },
      toggle,
    );

    // Register Cmd+Shift+A to open palette in assistant mode
    const unregisterAssistant = shortcutManager.register(
      {
        id: 'open-assistant',
        keys: 'mod+shift+a',
        scope: 'global',
        preventDefault: true,
      },
      openInAssistantMode,
    );

    // Set up keydown listener
    const handleKeyDown = (event: KeyboardEvent) => {
      shortcutManager.handleKeyDown(event);
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      unregisterToggle();
      unregisterAssistant();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [toggle, openInAssistantMode]);

  // Note: Palette-specific keyboard navigation is handled in CommandPalette
  // component via onKeyDown on the Dialog.Content element. This keeps the
  // keyboard handling co-located with the UI and properly scoped to when
  // the dialog is focused.

  // ----- Reset selected index when filtered actions change -----

  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredActions.length]);

  // ----- Context Value -----

  const value = useMemo<CommandPaletteContextValue>(
    () => ({
      isOpen,
      mode,
      open,
      close,
      toggle,
      query,
      setQuery,
      context,
      filteredActions,
      selectedIndex,
      setSelectedIndex,
      navigationStack,
      pushNavigation,
      popNavigation,
      clearNavigation,
      activeAction,
      setActiveAction,
      formData,
      setFormField,
      clearFormData,
      isExecuting,
      executeAction,
      formErrors,
      enterAssistantMode,
      exitAssistantMode,
      assistantInitialMessage,
      shouldShowAssistantHint,
    }),
    [
      isOpen,
      mode,
      open,
      close,
      toggle,
      query,
      context,
      filteredActions,
      selectedIndex,
      navigationStack,
      pushNavigation,
      popNavigation,
      clearNavigation,
      activeAction,
      formData,
      setFormField,
      clearFormData,
      isExecuting,
      executeAction,
      formErrors,
      enterAssistantMode,
      exitAssistantMode,
      assistantInitialMessage,
      shouldShowAssistantHint,
    ],
  );

  return <CommandPaletteContext.Provider value={value}>{children}</CommandPaletteContext.Provider>;
}

/**
 * Hook to access command palette context.
 *
 * Must be used within a `CommandPaletteProvider`. Throws if used outside.
 *
 * @returns Command palette context value
 * @throws Error if used outside of CommandPaletteProvider
 *
 * @example
 * // Open palette programmatically
 * function MyComponent() {
 *   const { open } = useCommandPalette();
 *
 *   return (
 *     <button onClick={() => open()}>
 *       Open Command Palette
 *     </button>
 *   );
 * }
 *
 * @example
 * // Check if palette is open
 * function StatusIndicator() {
 *   const { isOpen } = useCommandPalette();
 *
 *   return isOpen ? <span>Palette Open</span> : null;
 * }
 */
export function useCommandPalette(): CommandPaletteContextValue {
  const context = useContext(CommandPaletteContext);

  if (!context) {
    throw new Error(
      'useCommandPalette must be used within a CommandPaletteProvider. ' +
        'Make sure your component is wrapped in <CommandPaletteProvider>.',
    );
  }

  return context;
}
