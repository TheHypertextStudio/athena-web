/**
 * Undo/Redo System
 *
 * A comprehensive command-based undo/redo system for the application.
 *
 * ## Architecture
 *
 * The system uses a command pattern where each mutation creates an UndoCommand
 * that captures the state before and after the operation. Commands are stored
 * in a Zustand store and can be undone/redone via API calls.
 *
 * ## Components
 *
 * - **UndoProvider**: Context provider that sets up shortcuts and provides access
 * - **useUndo**: Hook to access undo/redo functionality from any component
 * - **useUndoableMutation**: Wrapper to make any mutation undoable
 * - **useUndoStore**: Direct access to undo/redo state (for advanced use)
 *
 * ## Usage
 *
 * ### 1. Add the provider to your layout:
 *
 * ```tsx
 * import { UndoProvider } from '@/lib/undo';
 *
 * function Layout({ children }) {
 *   return (
 *     <QueryClientProvider>
 *       <SnackbarProvider>
 *         <UndoProvider>
 *           {children}
 *         </UndoProvider>
 *       </SnackbarProvider>
 *     </QueryClientProvider>
 *   );
 * }
 * ```
 *
 * ### 2. Make mutations undoable:
 *
 * ```tsx
 * import { useUndoableMutation } from '@/lib/undo';
 *
 * function useUpdateEvent() {
 *   return useUndoableMutation(
 *     (data) => eventsApi.update(data.id, data.updates),
 *     {
 *       entityType: 'event',
 *       operationType: 'update',
 *       descriptionTemplate: 'Event updated',
 *       getEntityId: (input) => input.id,
 *       getQueryKeys: (input, id) => [['events', id], ['events']],
 *     }
 *   );
 * }
 * ```
 *
 * ### 3. Access undo/redo from components:
 *
 * ```tsx
 * import { useUndo } from '@/lib/undo';
 *
 * function UndoButtons() {
 *   const { performUndo, performRedo, canUndo, canRedo } = useUndo();
 *
 *   return (
 *     <>
 *       <button onClick={() => performUndo()} disabled={!canUndo}>
 *         Undo
 *       </button>
 *       <button onClick={() => performRedo()} disabled={!canRedo}>
 *         Redo
 *       </button>
 *     </>
 *   );
 * }
 * ```
 *
 * ## Keyboard Shortcuts
 *
 * The following shortcuts are registered globally:
 * - `Cmd+Z` / `Ctrl+Z` - Undo
 * - `Cmd+Shift+Z` / `Ctrl+Shift+Z` - Redo
 * - `Cmd+Alt+Z` / `Ctrl+Alt+Z` - Open history panel
 *
 * @packageDocumentation
 */

// Types
export type {
  UndoableEntityType,
  OperationType,
  EntitySnapshot,
  UndoCommand,
  UndoBatch,
  UndoStackItem,
  UndoableMutationConfig,
} from './types';
export { isUndoBatch } from './types';

// Store
export { useUndoStore, getUndoState } from './store';

// Hooks
export { useUndoableMutation, type UndoMutationContext } from './use-undoable-mutation';
export { useUndoExecutor } from './use-undo-executor';

// Provider and context hook
export { UndoProvider, useUndo } from './UndoProvider';

// Shortcut registration (for advanced use)
export { registerUndoShortcuts } from './register-shortcuts';
export type { UndoShortcutCallbacks } from './register-shortcuts';
