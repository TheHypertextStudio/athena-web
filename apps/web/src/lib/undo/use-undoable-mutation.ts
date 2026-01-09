/**
 * Undoable Mutation Hook
 *
 * Wrapper hook that makes any mutation undoable by capturing state
 * and registering with the undo system.
 *
 * @packageDocumentation
 */

'use client';

import { useMutation } from '@tanstack/react-query';
import type { UseMutationOptions, UseMutationResult } from '@tanstack/react-query';
import { useUndoStore } from './store';
import type { UndoCommand, UndoableMutationConfig } from './types';

/**
 * Generate a unique command ID.
 */
function generateCommandId(): string {
  return `cmd-${String(Date.now())}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Context type for mutations with previous data.
 */
export interface UndoMutationContext {
  previousData?: unknown;
}

/**
 * Hook that wraps a mutation to make it undoable.
 *
 * This hook:
 * 1. Executes the mutation
 * 2. Captures state before and after
 * 3. Pushes an undo command to the stack
 *
 * @example
 * ```typescript
 * const updateEvent = useUndoableMutation(
 *   (data) => eventsApi.update(data.id, data.updates),
 *   {
 *     entityType: 'event',
 *     operationType: 'update',
 *     descriptionTemplate: 'Event updated',
 *     getEntityId: (input) => input.id,
 *     getQueryKeys: (input, id) => [eventKeys.detail(id), eventKeys.lists()],
 *   }
 * );
 * ```
 */
export function useUndoableMutation<
  TData,
  TError,
  TVariables,
  TContext extends UndoMutationContext = UndoMutationContext,
>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  config: UndoableMutationConfig<TVariables, TData>,
  options?: Omit<UseMutationOptions<TData, TError, TVariables, TContext | undefined>, 'mutationFn'>,
): UseMutationResult<TData, TError, TVariables, TContext | undefined> {
  const pushCommand = useUndoStore((s) => s.pushCommand);
  const isProcessing = useUndoStore((s) => s.isProcessing);
  type MutationContext = TContext | undefined;

  // Extract just the options we care about to avoid TypeScript inference issues
  const userOnMutate = options?.onMutate as
    | ((variables: TVariables) => MutationContext | Promise<MutationContext>)
    | undefined;
  const userOnSuccess = options?.onSuccess as
    | ((data: TData, variables: TVariables, context: MutationContext) => void)
    | undefined;
  const userOnError = options?.onError as
    | ((error: TError, variables: TVariables, context: MutationContext) => void)
    | undefined;
  const userOnSettled = options?.onSettled as
    | ((
        data: TData | undefined,
        error: TError | null,
        variables: TVariables,
        context: MutationContext,
      ) => void)
    | undefined;

  // Exclude callback properties before spreading
  const baseOptions = options
    ? (({
        onMutate: _onMutate,
        onSuccess: _onSuccess,
        onError: _onError,
        onSettled: _onSettled,
        ...rest
      }) => rest)(options)
    : {};

  return useMutation<TData, TError, TVariables, MutationContext>({
    mutationFn,
    ...baseOptions,
    onMutate: async (variables) => {
      // Call original onMutate if provided (for optimistic updates)
      let originalContext: MutationContext = undefined;
      if (userOnMutate) {
        const result = userOnMutate(variables);
        originalContext = result instanceof Promise ? await result : result;
      }

      return originalContext;
    },
    onSuccess: (data, variables, context) => {
      // Don't record commands during undo/redo processing
      if (isProcessing) {
        userOnSuccess?.(data, variables, context);
        return;
      }

      const entityId = config.getEntityId(variables, data);
      const queryKeys = config.getQueryKeys(variables, entityId);

      // Build the description
      const description =
        typeof config.descriptionTemplate === 'function'
          ? config.descriptionTemplate(variables, data)
          : config.descriptionTemplate;

      // Build snapshot data
      const snapshotData = config.getSnapshotData ? config.getSnapshotData(data) : data;

      // Create the undo command
      const command: UndoCommand = {
        id: generateCommandId(),
        timestamp: Date.now(),
        description,
        operationType: config.operationType,
        entityType: config.entityType,
        entityId,
        previousSnapshot: context?.previousData
          ? { entityType: config.entityType, entityId, data: context.previousData }
          : null,
        newSnapshot:
          config.operationType !== 'delete'
            ? { entityType: config.entityType, entityId, data: snapshotData }
            : null,
        queryKeys,
      };

      // Push to undo stack
      pushCommand(command);

      // Call original onSuccess
      userOnSuccess?.(data, variables, context);
    },
    onError: (error, variables, context) => {
      userOnError?.(error, variables, context);
    },
    onSettled: (data, error, variables, context) => {
      userOnSettled?.(data, error, variables, context);
    },
  });
}
