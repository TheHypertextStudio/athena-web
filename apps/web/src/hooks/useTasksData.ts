/**
 * Data layer hook for tasks.
 *
 * Provides React Query-based data fetching and mutations for tasks.
 * Separates data concerns from UI state for better composability.
 *
 * @packageDocumentation
 */

'use client';

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tasksApi, type Task, type CreateTaskInput, type UpdateTaskInput } from '@/lib/api-client';

type TaskStatus = Task['status'];
type TaskPriority = Task['priority'];

export interface TaskFilters {
  status?: TaskStatus | 'all';
  priority?: TaskPriority | 'all';
  projectId?: string;
}

export interface UseTasksDataOptions {
  /** Initial filters to apply */
  filters?: TaskFilters;
  /** Whether to enable the query */
  enabled?: boolean;
}

export interface UseTasksDataReturn {
  /** List of tasks */
  tasks: Task[];
  /** Whether the initial load is in progress */
  isLoading: boolean;
  /** Whether a refetch is in progress */
  isFetching: boolean;
  /** Error if the query failed */
  error: Error | null;
  /** Create a new task */
  createTask: (input: CreateTaskInput) => Promise<Task>;
  /** Update an existing task */
  updateTask: (id: string, input: UpdateTaskInput) => Promise<Task>;
  /** Delete a task */
  deleteTask: (id: string) => Promise<void>;
  /** Refetch tasks */
  refetch: () => void;
  /** Whether a mutation is in progress */
  isMutating: boolean;
}

/**
 * Hook for fetching and mutating tasks data.
 *
 * @example
 * ```tsx
 * const { tasks, isLoading, createTask, updateTask } = useTasksData({
 *   filters: { status: 'pending', priority: 'high' }
 * });
 * ```
 */
export function useTasksData(options: UseTasksDataOptions = {}): UseTasksDataReturn {
  const { filters = {}, enabled = true } = options;
  const queryClient = useQueryClient();

  // Build query params from filters
  const queryParams: Parameters<typeof tasksApi.list>[0] = {};
  if (filters.status && filters.status !== 'all') {
    queryParams.status = filters.status;
  }
  if (filters.priority && filters.priority !== 'all') {
    queryParams.priority = filters.priority;
  }
  if (filters.projectId && filters.projectId !== 'all') {
    queryParams.projectId = filters.projectId;
  }

  // Query for fetching tasks
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['tasks', queryParams],
    queryFn: async () => {
      const response = await tasksApi.list(queryParams);
      return response.data;
    },
    enabled,
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (input: CreateTaskInput) => {
      const response = await tasksApi.create(input);
      return response.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateTaskInput }) => {
      const response = await tasksApi.update(id, input);
      return response.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await tasksApi.delete(id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const createTask = useCallback(
    async (input: CreateTaskInput): Promise<Task> => {
      return createMutation.mutateAsync(input);
    },
    [createMutation],
  );

  const updateTask = useCallback(
    async (id: string, input: UpdateTaskInput): Promise<Task> => {
      return updateMutation.mutateAsync({ id, input });
    },
    [updateMutation],
  );

  const deleteTask = useCallback(
    async (id: string): Promise<void> => {
      await deleteMutation.mutateAsync(id);
    },
    [deleteMutation],
  );

  const handleRefetch = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    tasks: data ?? [],
    isLoading,
    isFetching,
    error,
    createTask,
    updateTask,
    deleteTask,
    refetch: handleRefetch,
    isMutating: createMutation.isPending || updateMutation.isPending || deleteMutation.isPending,
  };
}
