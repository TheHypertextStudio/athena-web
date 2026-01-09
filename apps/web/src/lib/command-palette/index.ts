/**
 * Command palette library.
 *
 * This module exports all the building blocks for the command palette system:
 *
 * - **Types** - TypeScript interfaces and types
 * - **Registry** - Action registration and querying
 * - **Shortcuts** - Keyboard shortcut management
 * - **Fuzzy Search** - Search algorithm for matching actions
 *
 * @packageDocumentation
 */

// Types - All type definitions
export type {
  // Keyboard shortcuts
  Modifier,
  ShortcutScope,
  KeyboardShortcut,
  ShortcutManager,
  // Context system
  EntityType,
  SelectedEntity,
  WorkspaceContext,
  TimerContext,
  UserContext,
  CommandContext,
  // Action system
  ActionCategory,
  CategoryMeta,
  ActionInput,
  ActionResult,
  ActionGroup,
  ExecutableAction,
  Action,
  // Form system
  FieldType,
  SelectOption,
  FormField,
  ActionForm,
  // Palette state
  NavigationItem,
  PaletteState,
  // Registry
  ActionRegistry,
} from './types';

// Registry - Action management
export {
  createActionRegistry,
  getActionRegistry,
  resetActionRegistry,
  findActionInGroup,
  flattenActions,
} from './registry';

// Shortcuts - Keyboard handling
export { createShortcutManager, getShortcutManager } from './shortcuts';

// Fuzzy Search - Search algorithm
export { fuzzySearch, fuzzySearchInGroup } from './fuzzy-search';
export type { FuzzyMatch } from './fuzzy-search';
