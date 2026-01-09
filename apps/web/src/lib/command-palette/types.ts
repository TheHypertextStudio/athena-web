/**
 * Command palette type definitions.
 *
 * @packageDocumentation
 */

import type { LucideIcon } from 'lucide-react';
import type { z } from 'zod';

// =============================================================================
// Keyboard Shortcuts
// =============================================================================

/**
 * Modifier keys - 'mod' resolves to Cmd on Mac, Ctrl on Windows/Linux.
 */
export type Modifier = 'mod' | 'ctrl' | 'alt' | 'shift' | 'meta';

/**
 * Scope where a shortcut is active.
 */
export type ShortcutScope = 'global' | 'palette' | 'editor';

/**
 * A keyboard shortcut definition.
 *
 * @example
 * // Single key combination
 * { id: 'open-palette', keys: 'mod+k', scope: 'global' }
 *
 * @example
 * // Vim-style sequence
 * { id: 'create-task', keys: 'g t', scope: 'global' }
 */
export interface KeyboardShortcut {
  /** Unique identifier matching action ID */
  id: string;

  /** Key combination(s) - supports sequences like 'g t' for vim-style */
  keys: string;

  /** Human-readable display (auto-generated if not provided) */
  display?: string;

  /** Scope where shortcut is active */
  scope: ShortcutScope;

  /** Whether shortcut works when focus is in an input/textarea */
  allowInInput?: boolean;

  /** Prevent default browser behavior */
  preventDefault?: boolean;
}

/**
 * Shortcut manager interface for registration and dispatch.
 */
export interface ShortcutManager {
  /** Register a shortcut with its handler. Returns unregister function. */
  register(shortcut: KeyboardShortcut, handler: () => void): () => void;

  /** Unregister a shortcut by ID. */
  unregister(id: string): void;

  /** Get shortcuts that conflict with the given keys. */
  getConflicts(keys: string): KeyboardShortcut[];

  /** Format keys for display (e.g., 'mod+k' → '⌘K' on Mac). */
  formatForDisplay(keys: string): string;

  /** Check if a shortcut is currently registered and active. */
  isActive(id: string): boolean;
}

// =============================================================================
// Context System
// =============================================================================

/** Entity types that can be selected in the app. */
export type EntityType = 'task' | 'project' | 'initiative' | 'event' | 'moment' | 'tag';

/**
 * Selected entity with full data for context-aware actions.
 */
export interface SelectedEntity<T = unknown> {
  type: EntityType;
  id: string;
  data: T;
}

/**
 * Workspace scope context.
 */
export interface WorkspaceContext {
  id: string;
  name: string;
  isPersonal: boolean;
}

/**
 * Active timer state for time tracking.
 */
export interface TimerContext {
  isRunning: boolean;
  taskId: string | null;
  taskTitle: string | null;
  startedAt: Date;
  /** Elapsed seconds, updated periodically when running. */
  elapsed: number;
}

/**
 * Authenticated user context.
 */
export interface UserContext {
  id: string;
  name: string;
}

/**
 * Full command context composed from multiple providers.
 * Each piece is optional to support partial context.
 */
export interface CommandContext {
  /** Current route path */
  route: string;

  /** Route parameters */
  params: Record<string, string>;

  /** Selected entity (from page or selection) */
  entity: SelectedEntity | null;

  /** Active workspace */
  workspace: WorkspaceContext | null;

  /** Active timer state */
  timer: TimerContext | null;

  /** Authenticated user */
  user: UserContext | null;
}

// =============================================================================
// Action System
// =============================================================================

/** Action categories for top-level grouping in palette. */
export type ActionCategory =
  | 'navigation'
  | 'create'
  | 'entity'
  | 'search'
  | 'time'
  | 'settings'
  | 'ai';

/** Category metadata for display. */
export interface CategoryMeta {
  id: ActionCategory;
  label: string;
  icon: LucideIcon;
  priority: number;
}

/**
 * Input provided to action execute function.
 */
export interface ActionInput {
  formData: Record<string, unknown> | null;
  context: CommandContext;
}

/**
 * Result from executing an action.
 */
export interface ActionResult {
  success: boolean;
  message?: string;
  /** Navigate to this path after success. */
  navigateTo?: string;
  /** Invalidate these TanStack Query keys. */
  invalidate?: string[];
  /** Data to pass to next action in chain. */
  data?: unknown;
}

/**
 * Action group that contains other actions (for nested navigation).
 */
export interface ActionGroup {
  type: 'group';
  id: string;
  label: string;
  icon: LucideIcon;
  category: ActionCategory;
  children: Action[];
  /** Keywords for search. */
  keywords?: string[];
  /** When to show this group. */
  isAvailable?: (ctx: CommandContext) => boolean;
}

/**
 * Executable action that performs an operation.
 */
export interface ExecutableAction {
  type: 'action';
  id: string;
  label: string;
  icon: LucideIcon;
  category: ActionCategory;

  /** Search keywords beyond label. */
  keywords?: string[];

  /** Keyboard shortcut (registered globally). */
  shortcut?: KeyboardShortcut;

  /** Sort priority within category (higher first). */
  priority?: number;

  /**
   * When action is available.
   * - Return `false` to hide completely.
   * - Return `string` to show disabled with reason.
   * - Return `true` to show enabled.
   */
  isAvailable?: (ctx: CommandContext) => boolean | string;

  /** Inline form definition. If present, form shown before execute. */
  form?: ActionForm | ((ctx: CommandContext) => ActionForm);

  /** Execute the action. */
  execute: (input: ActionInput) => Promise<ActionResult>;
}

/** Union type for all action types. */
export type Action = ActionGroup | ExecutableAction;

// =============================================================================
// Form System
// =============================================================================

/** Available form field types. */
export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'combobox'
  | 'date'
  | 'time'
  | 'datetime'
  | 'checkbox'
  | 'toggle';

/**
 * Option for select/combobox fields.
 */
export interface SelectOption {
  value: string;
  label: string;
  icon?: LucideIcon;
  description?: string;
}

/**
 * Form field definition.
 */
export interface FormField<T = unknown> {
  name: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  description?: string;

  /** Zod schema for validation. */
  schema: z.ZodType<T>;

  /** Default value or function to compute from context. */
  defaultValue?: T | ((ctx: CommandContext) => T);

  /** For select/combobox - static or dynamic options. */
  options?: SelectOption[] | ((ctx: CommandContext) => Promise<SelectOption[]>);

  /** Conditionally show field based on other form values. */
  when?: (formData: Record<string, unknown>) => boolean;

  /** Mark field as required (schema should also enforce this). */
  required?: boolean;
}

/**
 * Inline form definition for actions.
 */
export interface ActionForm {
  fields: FormField[];
  submitLabel?: string;
  /** Layout: stack (default) or grid. */
  layout?: 'stack' | 'grid';
  /** Auto-focus first field. */
  autoFocus?: boolean;
}

// =============================================================================
// Palette State
// =============================================================================

/**
 * Navigation stack item for nested navigation.
 */
export interface NavigationItem {
  action: ActionGroup;
  query: string;
}

/**
 * Command palette UI state.
 */
export interface PaletteState {
  /** Whether the palette is open. */
  isOpen: boolean;

  /** Current search query. */
  query: string;

  /** Currently highlighted item index. */
  selectedIndex: number;

  /** Navigation stack for nested groups. */
  navigationStack: NavigationItem[];

  /** Active action for inline form mode. */
  activeAction: ExecutableAction | null;

  /** Current form data when in form mode. */
  formData: Record<string, unknown>;

  /** Whether an action is currently executing. */
  isExecuting: boolean;

  /** Form validation errors. */
  formErrors: Record<string, string>;
}

// =============================================================================
// Registry
// =============================================================================

/**
 * Action registry for managing available actions.
 */
export interface ActionRegistry {
  /** All registered actions. */
  actions: Map<string, Action>;

  /** Register an action. */
  register(action: Action): void;

  /** Unregister an action by ID. */
  unregister(actionId: string): void;

  /** Get available actions filtered by context and query. */
  getAvailableActions(context: CommandContext, query: string): Action[];

  /** Get a specific action by ID. */
  getAction(actionId: string): Action | undefined;

  /** Get all actions in a category. */
  getActionsByCategory(category: ActionCategory): Action[];
}
