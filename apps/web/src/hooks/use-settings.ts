'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi, accountApi, type UpdateSettingsInput } from '@/lib/api-client';

/**
 * Hook for managing user settings.
 */
export function useSettings() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get(),
  });

  const updateMutation = useMutation({
    mutationFn: (updates: UpdateSettingsInput) => settingsApi.update(updates),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  return {
    settings: data?.data,
    isLoading,
    error,
    update: updateMutation.mutate,
    updateAsync: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
  };
}

/**
 * Hook for managing account overview.
 */
export function useAccount() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['account'],
    queryFn: () => accountApi.get(),
  });

  const exportMutation = useMutation({
    mutationFn: () => accountApi.export(),
  });

  const deleteMutation = useMutation({
    mutationFn: (confirmation: string) => accountApi.delete(confirmation),
  });

  return {
    account: data?.data,
    isLoading,
    error,
    exportData: exportMutation.mutate,
    exportDataAsync: exportMutation.mutateAsync,
    isExporting: exportMutation.isPending,
    deleteAccount: deleteMutation.mutate,
    deleteAccountAsync: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
  };
}
