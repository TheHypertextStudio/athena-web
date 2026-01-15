/**
 * Time blocks data hooks using TanStack Query.
 *
 * @packageDocumentation
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  timeBlocksApi,
  timeBlockKeys,
  type TimeBlock,
  type CreateTimeBlockInput,
  type UpdateTimeBlockInput,
} from '@/lib/api-client';
import { useUndoableMutation } from '@/lib/undo';

/**
 * Hook for fetching time blocks within a date range.
 */
export function useTimeBlocks(params?: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: timeBlockKeys.list(params),
    queryFn: () => timeBlocksApi.list(params),
    staleTime: 30_000, // 30 seconds
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook for fetching a single time block by ID.
 */
export function useTimeBlock(id: string) {
  return useQuery({
    queryKey: timeBlockKeys.detail(id),
    queryFn: () => timeBlocksApi.get(id),
    enabled: !!id,
  });
}

/**
 * Hook for creating a time block.
 */
export function useCreateTimeBlock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateTimeBlockInput) => timeBlocksApi.create(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: timeBlockKeys.lists() });
    },
  });
}

/**
 * Hook for updating a time block with optimistic updates.
 */
export function useUpdateTimeBlock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTimeBlockInput }) =>
      timeBlocksApi.update(id, data),
    onMutate: async ({ id, data }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: timeBlockKeys.detail(id) });

      // Snapshot the previous value
      const previousBlock = queryClient.getQueryData<{ data: TimeBlock }>(timeBlockKeys.detail(id));

      // Optimistically update the cache
      if (previousBlock) {
        queryClient.setQueryData(timeBlockKeys.detail(id), {
          data: { ...previousBlock.data, ...data },
        });
      }

      return { previousBlock };
    },
    onError: (_err, { id }, context) => {
      // Rollback on error
      if (context?.previousBlock) {
        queryClient.setQueryData(timeBlockKeys.detail(id), context.previousBlock);
      }
    },
    onSettled: (_data, _error, { id }) => {
      // Refetch to ensure server state
      void queryClient.invalidateQueries({ queryKey: timeBlockKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: timeBlockKeys.lists() });
    },
  });
}

/**
 * Hook for deleting a time block.
 */
export function useDeleteTimeBlock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => timeBlocksApi.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: timeBlockKeys.lists() });
    },
  });
}

/**
 * Hook for fetching time blocks for a specific day.
 * Uses full ISO timestamps to properly filter across timezone boundaries.
 */
export function useTimeBlocksForDay(date: Date) {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);

  const dayEnd = new Date(date);
  dayEnd.setDate(dayEnd.getDate() + 1);
  dayEnd.setHours(0, 0, 0, 0);

  return useTimeBlocks({
    startDate: dayStart.toISOString(),
    endDate: dayEnd.toISOString(),
  });
}

/**
 * Hook for linking a task to a time block.
 */
export function useLinkTaskToTimeBlock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      timeBlockId,
      taskId,
      position,
    }: {
      timeBlockId: string;
      taskId: string;
      position?: number;
    }) => timeBlocksApi.linkTask(timeBlockId, taskId, position),
    onSuccess: (_data, { timeBlockId }) => {
      void queryClient.invalidateQueries({ queryKey: timeBlockKeys.detail(timeBlockId) });
      void queryClient.invalidateQueries({ queryKey: timeBlockKeys.lists() });
    },
  });
}

/**
 * Hook for unlinking a task from a time block.
 */
export function useUnlinkTaskFromTimeBlock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ timeBlockId, taskId }: { timeBlockId: string; taskId: string }) =>
      timeBlocksApi.unlinkTask(timeBlockId, taskId),
    onSuccess: (_data, { timeBlockId }) => {
      void queryClient.invalidateQueries({ queryKey: timeBlockKeys.detail(timeBlockId) });
      void queryClient.invalidateQueries({ queryKey: timeBlockKeys.lists() });
    },
  });
}

/**
 * Hook for reordering tasks within a time block.
 */
export function useReorderTimeBlockTasks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ timeBlockId, taskIds }: { timeBlockId: string; taskIds: string[] }) =>
      timeBlocksApi.reorderTasks(timeBlockId, taskIds),
    onSuccess: (_data, { timeBlockId }) => {
      void queryClient.invalidateQueries({ queryKey: timeBlockKeys.detail(timeBlockId) });
    },
  });
}

// =============================================================================
// Undoable Mutations
// =============================================================================

/**
 * Hook for creating a time block with undo support and optimistic updates.
 */
interface CreateTimeBlockContext {
  tempId: string;
  previousData?: unknown;
}

export function useUndoableCreateTimeBlock() {
  const queryClient = useQueryClient();

  return useUndoableMutation<
    { data: TimeBlock },
    Error,
    CreateTimeBlockInput,
    CreateTimeBlockContext
  >(
    (data) => timeBlocksApi.create(data),
    {
      entityType: 'time-block',
      operationType: 'create',
      descriptionTemplate: (input) => `Time block "${input.label}" created`,
      getEntityId: (_input, result) => result?.data.id ?? '',
      getQueryKeys: () => [timeBlockKeys.lists()],
      getSnapshotData: (result) => result.data,
    },
    {
      onMutate: async (input) => {
        // Cancel outgoing refetches
        await queryClient.cancelQueries({ queryKey: timeBlockKeys.lists() });

        // Generate a temporary ID
        const tempId = `temp-${String(Date.now())}`;

        // Create optimistic time block
        const optimisticBlock: TimeBlock = {
          id: tempId,
          label: input.label,
          description: input.description ?? null,
          startTime: input.startTime,
          endTime: input.endTime,
          color: input.color ?? null,
          recurrenceRule: input.recurrenceRule ?? null,
          ownerId: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          linkedTasks: [],
        };

        // Add to all list caches
        queryClient.setQueriesData<{ data: TimeBlock[] }>(
          { queryKey: timeBlockKeys.lists() },
          (old) => {
            if (!old) return { data: [optimisticBlock] };
            return { data: [...old.data, optimisticBlock] };
          },
        );

        return { tempId };
      },
      onError: (_err, _input, context) => {
        // Remove optimistic entry on error
        if (context?.tempId) {
          queryClient.setQueriesData<{ data: TimeBlock[] }>(
            { queryKey: timeBlockKeys.lists() },
            (old) => {
              if (!old) return old;
              return { data: old.data.filter((b) => b.id !== context.tempId) };
            },
          );
        }
      },
      onSettled: () => {
        // Refetch to get the real data
        void queryClient.invalidateQueries({ queryKey: timeBlockKeys.lists() });
      },
    },
  );
}

/**
 * Hook for updating a time block with undo support.
 */
export function useUndoableUpdateTimeBlock() {
  const queryClient = useQueryClient();

  return useUndoableMutation<
    { data: TimeBlock },
    Error,
    { id: string; data: UpdateTimeBlockInput },
    { previousData?: TimeBlock }
  >(
    ({ id, data }) => timeBlocksApi.update(id, data),
    {
      entityType: 'time-block',
      operationType: 'update',
      descriptionTemplate: 'Time block updated',
      getEntityId: (input) => input.id,
      getQueryKeys: (input) => [timeBlockKeys.detail(input.id), timeBlockKeys.lists()],
      getSnapshotData: (result) => result.data,
    },
    {
      onMutate: async ({ id, data }) => {
        // Cancel any outgoing refetches
        await queryClient.cancelQueries({ queryKey: timeBlockKeys.detail(id) });

        // Snapshot the previous value
        const previousBlock = queryClient.getQueryData<{ data: TimeBlock }>(
          timeBlockKeys.detail(id),
        );

        // Optimistically update the cache
        if (previousBlock) {
          queryClient.setQueryData(timeBlockKeys.detail(id), {
            data: { ...previousBlock.data, ...data },
          });
        }

        return { previousData: previousBlock?.data };
      },
      onError: (_err, { id }, context) => {
        // Rollback on error
        if (context?.previousData) {
          queryClient.setQueryData(timeBlockKeys.detail(id), { data: context.previousData });
        }
      },
      onSettled: (_data, _error, { id }) => {
        // Refetch to ensure server state
        void queryClient.invalidateQueries({ queryKey: timeBlockKeys.detail(id) });
        void queryClient.invalidateQueries({ queryKey: timeBlockKeys.lists() });
      },
    },
  );
}

/**
 * Hook for deleting a time block with undo support.
 *
 * Note: To enable undo for deletes, we need the block data before deletion.
 */
export function useUndoableDeleteTimeBlock() {
  const queryClient = useQueryClient();

  return useUndoableMutation<
    unknown,
    Error,
    { id: string; blockData: TimeBlock },
    { previousData?: TimeBlock }
  >(
    ({ id }) => timeBlocksApi.delete(id),
    {
      entityType: 'time-block',
      operationType: 'delete',
      descriptionTemplate: (input) => `Time block "${input.blockData.label}" deleted`,
      getEntityId: (input) => input.id,
      getQueryKeys: () => [timeBlockKeys.lists()],
    },
    {
      onMutate: ({ blockData }) => {
        return { previousData: blockData };
      },
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: timeBlockKeys.lists() });
      },
    },
  );
}
