/**
 * Undo Executor Hook
 *
 * Handles the actual execution of undo/redo operations by making API calls
 * to reverse or replay mutations.
 *
 * @packageDocumentation
 */

'use client';

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from '@/components/ui/snackbar';
import { useUndoStore } from './store';
import {
  tasksApi,
  eventsApi,
  timeBlocksApi,
  type CreateTaskInput,
  type CreateEventInput,
  type CreateTimeBlockInput,
} from '@/lib/api-client';
import type { UndoCommand, UndoableEntityType } from './types';
import { isUndoBatch } from './types';

/**
 * API registry for each entity type.
 * Maps entity types to their CRUD operations.
 */
const entityApis: Record<
  UndoableEntityType,
  {
    create: (data: Record<string, unknown>) => Promise<unknown>;
    update: (id: string, data: Record<string, unknown>) => Promise<unknown>;
    delete: (id: string) => Promise<unknown>;
  }
> = {
  task: {
    create: (data) => tasksApi.create(data as unknown as CreateTaskInput),
    update: (id, data) => tasksApi.update(id, data),
    delete: (id) => tasksApi.delete(id),
  },
  event: {
    create: (data) => eventsApi.create(data as unknown as CreateEventInput),
    update: (id, data) => eventsApi.update(id, data),
    delete: (id) => eventsApi.delete(id),
  },
  'time-block': {
    create: (data) => timeBlocksApi.create(data as unknown as CreateTimeBlockInput),
    update: (id, data) => timeBlocksApi.update(id, data),
    delete: (id) => timeBlocksApi.delete(id),
  },
  // Placeholder implementations for entity types without full CRUD
  project: {
    create: () => Promise.reject(new Error('Project create not implemented')),
    update: () => Promise.reject(new Error('Project update not implemented')),
    delete: () => Promise.reject(new Error('Project delete not implemented')),
  },
  initiative: {
    create: () => Promise.reject(new Error('Initiative create not implemented')),
    update: () => Promise.reject(new Error('Initiative update not implemented')),
    delete: () => Promise.reject(new Error('Initiative delete not implemented')),
  },
  tag: {
    create: () => Promise.reject(new Error('Tag create not implemented')),
    update: () => Promise.reject(new Error('Tag update not implemented')),
    delete: () => Promise.reject(new Error('Tag delete not implemented')),
  },
};

/**
 * Hook that provides undo/redo execution logic.
 *
 * @example
 * ```typescript
 * const { performUndo, performRedo, canUndo, canRedo } = useUndoExecutor();
 *
 * // In keyboard handler or button
 * if (canUndo) {
 *   await performUndo();
 * }
 * ```
 */
export function useUndoExecutor() {
  const queryClient = useQueryClient();
  const snackbar = useSnackbar();
  const {
    popUndo,
    popRedo,
    pushToRedo,
    pushToUndo,
    canUndo,
    canRedo,
    isProcessing,
    setProcessing,
    getUndoDescription,
    getRedoDescription,
    getHistory,
    getItemsToUndoTo,
    clearHistory,
  } = useUndoStore();

  /**
   * Execute a single undo command (reverse the operation).
   */
  const executeUndoCommand = useCallback(
    async (command: UndoCommand): Promise<void> => {
      const api = entityApis[command.entityType];

      switch (command.operationType) {
        case 'create':
          // To undo a create, we delete
          await api.delete(command.entityId);
          break;

        case 'update':
          // To undo an update, we restore previous data
          if (command.previousSnapshot?.data) {
            await api.update(
              command.entityId,
              command.previousSnapshot.data as Record<string, unknown>,
            );
          }
          break;

        case 'delete':
          // To undo a delete, we recreate with previous data
          if (command.previousSnapshot?.data) {
            await api.create(command.previousSnapshot.data as Record<string, unknown>);
          }
          break;
      }

      // Invalidate affected queries
      for (const queryKey of command.queryKeys) {
        await queryClient.invalidateQueries({ queryKey: queryKey as unknown[] });
      }
    },
    [queryClient],
  );

  /**
   * Execute a single redo command (replay the operation).
   */
  const executeRedoCommand = useCallback(
    async (command: UndoCommand): Promise<void> => {
      const api = entityApis[command.entityType];

      switch (command.operationType) {
        case 'create':
          // To redo a create, we create again with new data
          if (command.newSnapshot?.data) {
            await api.create(command.newSnapshot.data as Record<string, unknown>);
          }
          break;

        case 'update':
          // To redo an update, we apply new data
          if (command.newSnapshot?.data) {
            await api.update(command.entityId, command.newSnapshot.data as Record<string, unknown>);
          }
          break;

        case 'delete':
          // To redo a delete, we delete again
          await api.delete(command.entityId);
          break;
      }

      // Invalidate affected queries
      for (const queryKey of command.queryKeys) {
        await queryClient.invalidateQueries({ queryKey: queryKey as unknown[] });
      }
    },
    [queryClient],
  );

  /**
   * Perform undo operation.
   */
  const performUndo = useCallback(async (): Promise<boolean> => {
    if (!canUndo() || isProcessing) return false;

    setProcessing(true);
    try {
      const item = popUndo();
      if (!item) return false;

      if (isUndoBatch(item)) {
        // It's a batch - undo all commands in reverse order
        for (let i = item.commands.length - 1; i >= 0; i--) {
          const cmd = item.commands[i];
          if (cmd) {
            await executeUndoCommand(cmd);
          }
        }
        snackbar.show({ message: `Undid: ${item.description}` });
      } else {
        // Single command
        await executeUndoCommand(item);
        snackbar.show({ message: `Undid: ${item.description}` });
      }

      // Push to redo stack
      pushToRedo(item);

      return true;
    } catch (error) {
      console.error('Undo failed:', error);
      snackbar.show({ message: 'Undo failed' });
      return false;
    } finally {
      setProcessing(false);
    }
  }, [canUndo, isProcessing, popUndo, executeUndoCommand, snackbar, pushToRedo, setProcessing]);

  /**
   * Perform redo operation.
   */
  const performRedo = useCallback(async (): Promise<boolean> => {
    if (!canRedo() || isProcessing) return false;

    setProcessing(true);
    try {
      const item = popRedo();
      if (!item) return false;

      if (isUndoBatch(item)) {
        // It's a batch - redo all commands in order
        for (const command of item.commands) {
          await executeRedoCommand(command);
        }
        snackbar.show({ message: `Redid: ${item.description}` });
      } else {
        // Single command
        await executeRedoCommand(item);
        snackbar.show({ message: `Redid: ${item.description}` });
      }

      // Push to undo stack
      pushToUndo(item);

      return true;
    } catch (error) {
      console.error('Redo failed:', error);
      snackbar.show({ message: 'Redo failed' });
      return false;
    } finally {
      setProcessing(false);
    }
  }, [canRedo, isProcessing, popRedo, executeRedoCommand, snackbar, pushToUndo, setProcessing]);

  /**
   * Undo to a specific point in history.
   */
  const undoTo = useCallback(
    async (commandId: string): Promise<boolean> => {
      if (isProcessing) return false;

      const items = getItemsToUndoTo(commandId);
      if (items.length === 0) return false;

      setProcessing(true);
      try {
        for (const item of items) {
          void item;
          const popped = popUndo();
          if (!popped) break;

          if (isUndoBatch(popped)) {
            for (let i = popped.commands.length - 1; i >= 0; i--) {
              const cmd = popped.commands[i];
              if (cmd) {
                await executeUndoCommand(cmd);
              }
            }
          } else {
            await executeUndoCommand(popped);
          }

          pushToRedo(popped);
        }

        snackbar.show({
          message: `Undid ${String(items.length)} action${items.length > 1 ? 's' : ''}`,
        });
        return true;
      } catch (error) {
        console.error('Undo to point failed:', error);
        snackbar.show({ message: 'Undo failed' });
        return false;
      } finally {
        setProcessing(false);
      }
    },
    [
      isProcessing,
      getItemsToUndoTo,
      popUndo,
      executeUndoCommand,
      pushToRedo,
      snackbar,
      setProcessing,
    ],
  );

  return {
    performUndo,
    performRedo,
    undoTo,
    clearHistory,
    canUndo: canUndo(),
    canRedo: canRedo(),
    isProcessing,
    undoDescription: getUndoDescription(),
    redoDescription: getRedoDescription(),
    history: getHistory(),
  };
}
