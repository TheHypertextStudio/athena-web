'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/lib/api-client';
import {
  linkGoogleAccount,
  linkAppleAccount,
  linkMicrosoftAccount,
  registerPasskey,
} from '@/lib/auth-client';

/**
 * Hook for managing active sessions.
 */
export function useSessions() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: () => authApi.getSessions(),
  });

  const revokeMutation = useMutation({
    mutationFn: authApi.revokeSession,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
  });

  const revokeAllMutation = useMutation({
    mutationFn: authApi.revokeAllSessions,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
  });

  return {
    sessions: data?.sessions ?? [],
    count: data?.count ?? 0,
    isLoading,
    error,
    revokeSession: revokeMutation.mutate,
    isRevoking: revokeMutation.isPending,
    revokeAllSessions: revokeAllMutation.mutate,
    isRevokingAll: revokeAllMutation.isPending,
  };
}

/**
 * Hook for managing linked OAuth accounts.
 */
export function useLinkedAccounts() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['auth', 'linked-accounts'],
    queryFn: () => authApi.getLinkedAccounts(),
  });

  const unlinkMutation = useMutation({
    mutationFn: authApi.unlinkAccount,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['auth', 'linked-accounts'] });
    },
  });

  const accounts = data?.accounts ?? [];

  // Determine which providers are already linked
  const linkedProviders = new Set(accounts.map((a) => a.providerId));
  const hasGoogle = linkedProviders.has('google');
  const hasApple = linkedProviders.has('apple');
  const hasMicrosoft = linkedProviders.has('microsoft');

  // Link account functions - these redirect to OAuth flow
  const linkGoogle = (options?: { withCalendar?: boolean }) => {
    return linkGoogleAccount(options);
  };

  const linkApple = () => {
    return linkAppleAccount();
  };

  const linkMicrosoft = () => {
    return linkMicrosoftAccount();
  };

  return {
    accounts,
    count: data?.count ?? 0,
    isLoading,
    error,
    unlinkAccount: unlinkMutation.mutate,
    isUnlinking: unlinkMutation.isPending,
    // Provider status
    hasGoogle,
    hasApple,
    hasMicrosoft,
    // Link functions
    linkGoogle,
    linkApple,
    linkMicrosoft,
  };
}

/**
 * Hook for managing backup codes.
 */
export function useBackupCodes() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['auth', 'backup-codes'],
    queryFn: () => authApi.getBackupCodes(),
  });

  const generateMutation = useMutation({
    mutationFn: authApi.generateBackupCodes,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['auth', 'backup-codes'] });
    },
  });

  return {
    info: data,
    isLoading,
    error,
    generateCodes: generateMutation.mutateAsync,
    isGenerating: generateMutation.isPending,
    generatedCodes: generateMutation.data?.codes,
  };
}

/**
 * Hook for managing passkeys.
 */
export function usePasskeys() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['auth', 'passkeys'],
    queryFn: () => authApi.getPasskeys(),
  });

  const registerMutation = useMutation({
    mutationFn: async (name?: string) => {
      await registerPasskey(name);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['auth', 'passkeys'] });
    },
  });

  // Wrapper to call without arguments
  const doRegisterPasskey = async (name?: string) => {
    return registerMutation.mutateAsync(name);
  };

  const renameMutation = useMutation({
    mutationFn: ({ passkeyId, name }: { passkeyId: string; name: string }) =>
      authApi.renamePasskey(passkeyId, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['auth', 'passkeys'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: authApi.deletePasskey,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['auth', 'passkeys'] });
    },
  });

  return {
    passkeys: data?.passkeys ?? [],
    count: data?.count ?? 0,
    isLoading,
    error,
    // Register a new passkey
    registerPasskey: doRegisterPasskey,
    isRegistering: registerMutation.isPending,
    registerError: registerMutation.error,
    // Rename a passkey
    renamePasskey: renameMutation.mutate,
    isRenaming: renameMutation.isPending,
    // Delete a passkey
    deletePasskey: deleteMutation.mutate,
    isDeleting: deleteMutation.isPending,
    deleteError: deleteMutation.error,
  };
}
