'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsApi, type NotificationPreferences } from '@/lib/api-client';

/**
 * Hook for managing notification preferences.
 */
export function useNotificationPreferences() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: () => notificationsApi.getPreferences(),
  });

  const updateMutation = useMutation({
    mutationFn: (updates: Partial<NotificationPreferences>) =>
      notificationsApi.updatePreferences(updates),
    onMutate: async (newPrefs) => {
      await queryClient.cancelQueries({ queryKey: ['notifications', 'preferences'] });
      const previous = queryClient.getQueryData(['notifications', 'preferences']);
      queryClient.setQueryData(
        ['notifications', 'preferences'],
        (old: { data: NotificationPreferences } | undefined) => ({
          ...old,
          data: { ...old?.data, ...newPrefs },
        }),
      );
      return { previous };
    },
    onError: (_err, _new, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['notifications', 'preferences'], context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications', 'preferences'] });
    },
  });

  return {
    preferences: data?.data,
    isLoading,
    error,
    update: updateMutation.mutate,
    updateAsync: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
  };
}
