'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { aiApi, type AIPreferences } from '@/lib/api-client';

/**
 * Hook for managing AI preferences.
 */
export function useAIPreferences() {
  const queryClient = useQueryClient();

  const preferencesQuery = useQuery({
    queryKey: ['ai', 'preferences'],
    queryFn: () => aiApi.getPreferences(),
  });

  const providersQuery = useQuery({
    queryKey: ['ai', 'providers'],
    queryFn: () => aiApi.getProviders(),
  });

  const updateMutation = useMutation({
    mutationFn: (updates: Partial<AIPreferences>) => aiApi.updatePreferences(updates),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ai', 'preferences'] });
    },
  });

  return {
    preferences: preferencesQuery.data?.data,
    isLoadingPreferences: preferencesQuery.isLoading,
    providers: providersQuery.data?.data,
    isLoadingProviders: providersQuery.isLoading,
    update: updateMutation.mutate,
    updateAsync: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
  };
}
