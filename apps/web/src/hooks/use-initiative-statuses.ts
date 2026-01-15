'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  initiativeStatusesApi,
  initiativeStatusKeys,
  type CustomInitiativeStatus,
  type InitiativeStatusCategory,
  type CreateInitiativeStatusInput,
  type UpdateInitiativeStatusInput,
  type ReorderInitiativeStatusesInput,
} from '@/lib/api-client';

/**
 * Hook for managing custom initiative statuses.
 */
export function useInitiativeStatuses(workspaceId?: string) {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: initiativeStatusKeys.list({ workspaceId }),
    queryFn: () => initiativeStatusesApi.list({ workspaceId }),
  });

  const createMutation = useMutation({
    mutationFn: initiativeStatusesApi.create,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: initiativeStatusKeys.all });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateInitiativeStatusInput }) =>
      initiativeStatusesApi.update(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: initiativeStatusKeys.all });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: initiativeStatusesApi.delete,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: initiativeStatusKeys.all });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: initiativeStatusesApi.reorder,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: initiativeStatusKeys.all });
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: ({ id, workspaceId }: { id: string; workspaceId?: string }) =>
      initiativeStatusesApi.setDefault(id, workspaceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: initiativeStatusKeys.all });
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
 * Hook for getting grouped initiative statuses.
 */
export function useGroupedInitiativeStatuses(workspaceId?: string) {
  const { data, isLoading, error } = useQuery({
    queryKey: initiativeStatusKeys.grouped(workspaceId),
    queryFn: () => initiativeStatusesApi.listGrouped(workspaceId),
  });

  return {
    groupedStatuses: data?.data ?? {
      planning: [],
      active: [],
      completed: [],
      archived: [],
    },
    isLoading,
    error,
  };
}

/**
 * Hook for getting a single initiative status.
 */
export function useInitiativeStatus(id: string) {
  const { data, isLoading, error } = useQuery({
    queryKey: initiativeStatusKeys.detail(id),
    queryFn: () => initiativeStatusesApi.get(id),
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
export function getDefaultInitiativeStatus(
  statuses: CustomInitiativeStatus[],
  category: InitiativeStatusCategory,
): CustomInitiativeStatus | undefined {
  return statuses.find((s) => s.category === category && s.isDefault);
}

/**
 * Group statuses by category.
 */
export function groupInitiativeStatusesByCategory(statuses: CustomInitiativeStatus[]) {
  return {
    planning: statuses.filter((s) => s.category === 'planning'),
    active: statuses.filter((s) => s.category === 'active'),
    completed: statuses.filter((s) => s.category === 'completed'),
    archived: statuses.filter((s) => s.category === 'archived'),
  };
}

export type {
  CustomInitiativeStatus,
  InitiativeStatusCategory,
  CreateInitiativeStatusInput,
  UpdateInitiativeStatusInput,
  ReorderInitiativeStatusesInput,
};
