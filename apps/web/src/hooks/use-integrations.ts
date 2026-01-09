'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { integrationsApi, type IntegrationProvider } from '@/lib/api-client';

/**
 * Hook for managing integrations.
 */
export function useIntegrations() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['integrations'],
    queryFn: () => integrationsApi.list(),
  });

  const disconnectMutation = useMutation({
    mutationFn: integrationsApi.disconnect,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });

  const connectMutation = useMutation({
    mutationFn: async ({
      provider,
      redirectUri,
    }: {
      provider: IntegrationProvider;
      redirectUri: string;
    }) => {
      const result = await integrationsApi.getOAuthUrl(provider, redirectUri);
      if (result.data.authorizationUrl) {
        window.location.href = result.data.authorizationUrl;
      }
      return result;
    },
  });

  return {
    integrations: data?.data ?? [],
    isLoading,
    error,
    disconnect: disconnectMutation.mutate,
    isDisconnecting: disconnectMutation.isPending,
    connect: connectMutation.mutate,
    isConnecting: connectMutation.isPending,
  };
}
