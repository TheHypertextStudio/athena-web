'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  taskStatusesApi,
  taskStatusKeys,
  type CustomTaskStatus,
  type TaskStatusCategory,
  type CreateTaskStatusInput,
  type UpdateTaskStatusInput,
  type ReorderTaskStatusesInput,
} from '@/lib/api-client';

/**
 * Hook for managing custom task statuses.
 */
export function useCustomStatuses(workspaceId?: string) {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: taskStatusKeys.list({ workspaceId }),
    queryFn: () => taskStatusesApi.list({ workspaceId }),
  });

  const createMutation = useMutation({
    mutationFn: taskStatusesApi.create,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskStatusKeys.all });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTaskStatusInput }) =>
      taskStatusesApi.update(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskStatusKeys.all });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: taskStatusesApi.delete,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskStatusKeys.all });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: taskStatusesApi.reorder,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskStatusKeys.all });
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: ({ id, workspaceId }: { id: string; workspaceId?: string }) =>
      taskStatusesApi.setDefault(id, workspaceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskStatusKeys.all });
    },
  });

  return {
    statuses: data?.data ?? [],
    isLoading,
    error,
    create: createMutation.mutate,
    isCreating: createMutation.isPending,
    update: updateMutation.mutate,
    isUpdating: updateMutation.isPending,
    delete: deleteMutation.mutate,
    isDeleting: deleteMutation.isPending,
    reorder: reorderMutation.mutate,
    isReordering: reorderMutation.isPending,
    setDefault: setDefaultMutation.mutate,
    isSettingDefault: setDefaultMutation.isPending,
  };
}

/**
 * Hook for getting grouped task statuses.
 */
export function useGroupedStatuses(workspaceId?: string) {
  const { data, isLoading, error } = useQuery({
    queryKey: taskStatusKeys.grouped(workspaceId),
    queryFn: () => taskStatusesApi.listGrouped(workspaceId),
  });

  return {
    groupedStatuses: data?.data ?? {
      not_started: [],
      in_progress: [],
      done: [],
      cancelled: [],
    },
    isLoading,
    error,
  };
}

/**
 * Hook for getting a single task status.
 */
export function useTaskStatus(id: string) {
  const { data, isLoading, error } = useQuery({
    queryKey: taskStatusKeys.detail(id),
    queryFn: () => taskStatusesApi.get(id),
    enabled: !!id,
  });

  return {
    status: data?.data ?? null,
    isLoading,
    error,
  };
}

/**
 * Get the default status for a category from a list of statuses.
 */
export function getDefaultStatus(
  statuses: CustomTaskStatus[],
  category: TaskStatusCategory,
): CustomTaskStatus | undefined {
  return statuses.find((s) => s.category === category && s.isDefault);
}

/**
 * Group statuses by category.
 */
export function groupStatusesByCategory(statuses: CustomTaskStatus[]) {
  return {
    not_started: statuses.filter((s) => s.category === 'not_started'),
    in_progress: statuses.filter((s) => s.category === 'in_progress'),
    done: statuses.filter((s) => s.category === 'done'),
    cancelled: statuses.filter((s) => s.category === 'cancelled'),
  };
}

export type {
  CustomTaskStatus,
  TaskStatusCategory,
  CreateTaskStatusInput,
  UpdateTaskStatusInput,
  ReorderTaskStatusesInput,
};
