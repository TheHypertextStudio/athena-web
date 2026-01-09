/**
 * Undo/Redo Store
 *
 * Zustand store managing undo/redo stacks and batch operations.
 *
 * @packageDocumentation
 */

import { create } from 'zustand';
import type { UndoCommand, UndoBatch, UndoStackItem } from './types';
import { isUndoBatch } from './types';

interface UndoStore {
  /** Stack of commands that can be undone (most recent last) */
  undoStack: UndoStackItem[];

  /** Stack of commands that can be redone (most recent last) */
  redoStack: UndoStackItem[];

  /** Currently active batch ID (for grouping operations) */
  activeBatchId: string | null;

  /** Commands collected for the current batch */
  pendingBatchCommands: UndoCommand[];

  /** Batch description */
  pendingBatchDescription: string | null;

  /** Whether an undo/redo operation is currently in progress */
  isProcessing: boolean;

  // Actions

  /** Push a command to the undo stack */
  pushCommand: (command: UndoCommand) => void;

  /** Start a batch operation (for grouping multiple commands) */
  startBatch: (description: string) => string;

  /** End the current batch and push to undo stack */
  endBatch: () => void;

  /** Cancel the current batch without saving */
  cancelBatch: () => void;

  /** Pop from undo stack (returns item to process) */
  popUndo: () => UndoStackItem | null;

  /** Pop from redo stack (returns item to process) */
  popRedo: () => UndoStackItem | null;

  /** Push item back to redo stack (after undo) */
  pushToRedo: (item: UndoStackItem) => void;

  /** Push item back to undo stack (after redo) */
  pushToUndo: (item: UndoStackItem) => void;

  /** Clear redo stack (called when new mutation happens) */
  clearRedoStack: () => void;

  /** Clear all history */
  clearHistory: () => void;

  /** Undo to a specific command (returns items to undo) */
  getItemsToUndoTo: (commandId: string) => UndoStackItem[];

  /** Check if undo is available */
  canUndo: () => boolean;

  /** Check if redo is available */
  canRedo: () => boolean;

  /** Get the description of the next undo operation */
  getUndoDescription: () => string | null;

  /** Get the description of the next redo operation */
  getRedoDescription: () => string | null;

  /** Get all items in undo stack (for history panel) */
  getHistory: () => UndoStackItem[];

  /** Set processing state */
  setProcessing: (processing: boolean) => void;
}

function generateId(): string {
  return `${String(Date.now())}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useUndoStore = create<UndoStore>((set, get) => ({
  undoStack: [],
  redoStack: [],
  activeBatchId: null,
  pendingBatchCommands: [],
  pendingBatchDescription: null,
  isProcessing: false,

  pushCommand: (command) => {
    const { activeBatchId, pendingBatchCommands, isProcessing } = get();

    // Don't push commands during undo/redo processing
    if (isProcessing) return;

    if (activeBatchId) {
      // Add to pending batch
      set({
        pendingBatchCommands: [...pendingBatchCommands, command],
      });
    } else {
      // Add as single command and clear redo stack
      set((state) => ({
        undoStack: [...state.undoStack, command],
        redoStack: [],
      }));
    }
  },

  startBatch: (description) => {
    const batchId = `batch-${generateId()}`;
    set({
      activeBatchId: batchId,
      pendingBatchCommands: [],
      pendingBatchDescription: description,
    });
    return batchId;
  },

  endBatch: () => {
    const { activeBatchId, pendingBatchCommands, pendingBatchDescription } = get();

    if (!activeBatchId || pendingBatchCommands.length === 0) {
      set({
        activeBatchId: null,
        pendingBatchCommands: [],
        pendingBatchDescription: null,
      });
      return;
    }

    const batch: UndoBatch = {
      id: activeBatchId,
      description:
        pendingBatchDescription ?? pendingBatchCommands[0]?.description ?? 'Multiple changes',
      commands: pendingBatchCommands,
      timestamp: Date.now(),
    };

    set((state) => ({
      undoStack: [...state.undoStack, batch],
      redoStack: [],
      activeBatchId: null,
      pendingBatchCommands: [],
      pendingBatchDescription: null,
    }));
  },

  cancelBatch: () => {
    set({
      activeBatchId: null,
      pendingBatchCommands: [],
      pendingBatchDescription: null,
    });
  },

  popUndo: () => {
    const { undoStack } = get();
    if (undoStack.length === 0) return null;

    const item = undoStack[undoStack.length - 1];
    set((state) => ({
      undoStack: state.undoStack.slice(0, -1),
    }));

    return item ?? null;
  },

  popRedo: () => {
    const { redoStack } = get();
    if (redoStack.length === 0) return null;

    const item = redoStack[redoStack.length - 1];
    set((state) => ({
      redoStack: state.redoStack.slice(0, -1),
    }));

    return item ?? null;
  },

  pushToRedo: (item) => {
    set((state) => ({
      redoStack: [...state.redoStack, item],
    }));
  },

  pushToUndo: (item) => {
    set((state) => ({
      undoStack: [...state.undoStack, item],
    }));
  },

  clearRedoStack: () => {
    set({ redoStack: [] });
  },

  clearHistory: () => {
    set({ undoStack: [], redoStack: [] });
  },

  getItemsToUndoTo: (commandId) => {
    const { undoStack } = get();
    const items: UndoStackItem[] = [];

    // Find the index of the target command
    let targetIndex = -1;
    for (let i = undoStack.length - 1; i >= 0; i--) {
      const item = undoStack[i];
      if (!item) continue;

      if (isUndoBatch(item)) {
        if (item.id === commandId) {
          targetIndex = i;
          break;
        }
      } else {
        if (item.id === commandId) {
          targetIndex = i;
          break;
        }
      }
    }

    if (targetIndex === -1) return [];

    // Collect all items from the end to the target (inclusive)
    for (let i = undoStack.length - 1; i >= targetIndex; i--) {
      const item = undoStack[i];
      if (item) {
        items.push(item);
      }
    }

    return items;
  },

  canUndo: () => get().undoStack.length > 0,

  canRedo: () => get().redoStack.length > 0,

  getUndoDescription: () => {
    const { undoStack } = get();
    if (undoStack.length === 0) return null;
    const item = undoStack[undoStack.length - 1];
    return item?.description ?? null;
  },

  getRedoDescription: () => {
    const { redoStack } = get();
    if (redoStack.length === 0) return null;
    const item = redoStack[redoStack.length - 1];
    return item?.description ?? null;
  },

  getHistory: () => get().undoStack,

  setProcessing: (processing) => {
    set({ isProcessing: processing });
  },
}));

/**
 * Get undo store state outside of React components.
 */
export function getUndoState() {
  return useUndoStore.getState();
}
