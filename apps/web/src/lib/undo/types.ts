/**
 * Undo/Redo System Types
 *
 * Type definitions for the command-based undo/redo system.
 *
 * @packageDocumentation
 */

/**
 * Entity types that support undo/redo operations.
 */
export type UndoableEntityType = 'task' | 'event' | 'time-block' | 'project' | 'initiative' | 'tag';

/**
 * Operation types for mutations.
 */
export type OperationType = 'create' | 'update' | 'delete';

/**
 * A snapshot of entity data before/after a mutation.
 */
export interface EntitySnapshot<T = unknown> {
  entityType: UndoableEntityType;
  entityId: string;
  data: T;
}

/**
 * A single undoable command representing one mutation.
 */
export interface UndoCommand<T = unknown> {
  /** Unique identifier for this command */
  id: string;

  /** Timestamp when the command was executed */
  timestamp: number;

  /** Human-readable description (e.g., "Event moved") */
  description: string;

  /** The type of operation performed */
  operationType: OperationType;

  /** Entity type affected */
  entityType: UndoableEntityType;

  /** Entity ID affected */
  entityId: string;

  /** Snapshot before the mutation (for update/delete) */
  previousSnapshot: EntitySnapshot<T> | null;

  /** Snapshot after the mutation (for create/update) */
  newSnapshot: EntitySnapshot<T> | null;

  /** Query keys to invalidate when undoing/redoing */
  queryKeys: readonly (readonly unknown[])[];

  /** Optional: batch ID for grouped operations */
  batchId?: string;
}

/**
 * A batch of commands that should be undone/redone together.
 */
export interface UndoBatch {
  id: string;
  description: string;
  commands: UndoCommand[];
  timestamp: number;
}

/**
 * Union type for items in the undo/redo stack.
 */
export type UndoStackItem = UndoCommand | UndoBatch;

/**
 * Type guard to check if an item is a batch.
 */
export function isUndoBatch(item: UndoStackItem): item is UndoBatch {
  return 'commands' in item;
}

/**
 * Configuration for creating an undoable mutation.
 */
export interface UndoableMutationConfig<TInput, TData> {
  /** Entity type being mutated */
  entityType: UndoableEntityType;

  /** Operation type */
  operationType: OperationType;

  /** Human-readable description template */
  descriptionTemplate: string | ((input: TInput, data: TData) => string);

  /** Extract entity ID from input or result */
  getEntityId: (input: TInput, result?: TData) => string;

  /** Query keys to invalidate */
  getQueryKeys: (input: TInput, entityId: string) => readonly (readonly unknown[])[];

  /** Extract snapshot data from API response */
  getSnapshotData?: (data: TData) => unknown;
}
