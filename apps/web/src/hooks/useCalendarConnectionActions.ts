/**
 * Calendar connection actions hook.
 *
 * Handles mutations for calendar connections:
 * - Updating connection settings (label, color)
 * - Setting primary connection
 * - Disconnecting connections
 *
 * @packageDocumentation
 */

'use client';

import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  calendarSyncApi,
  calendarSyncKeys,
  eventKeys,
  type AccountSettingsUpdate,
} from '@/lib/api-client';

export interface UseCalendarConnectionActionsReturn {
  /** Update connection settings (label, color, primary status) */
  updateConnectionSettings: (connectionId: string, settings: AccountSettingsUpdate) => void;
  /** Set a connection as primary */
  setConnectionPrimary: (connectionId: string) => void;
  /** Whether a connection update is in progress */
  isUpdatingConnection: boolean;
  /** Disconnect a calendar connection */
  disconnect: (connectionId: string) => void;
  /** Whether a disconnect is in progress */
  isDisconnecting: boolean;
}

/**
 * Hook for managing calendar connection settings.
 */
export function useCalendarConnectionActions(): UseCalendarConnectionActionsReturn {
  const queryClient = useQueryClient();

  // Update connection settings mutation
  const updateConnectionMutation = useMutation({
    mutationFn: ({
      connectionId,
      settings,
    }: {
      connectionId: string;
      settings: AccountSettingsUpdate;
    }) => calendarSyncApi.updateAccountSettings(connectionId, settings),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: calendarSyncKeys.connections() });
    },
  });

  // Disconnect mutation
  const disconnectMutation = useMutation({
    mutationFn: (connectionId: string) => calendarSyncApi.disconnect(connectionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: calendarSyncKeys.connections() });
      void queryClient.invalidateQueries({ queryKey: eventKeys.lists() });
    },
  });

  const updateConnectionSettings = useCallback(
    (connectionId: string, settings: AccountSettingsUpdate) => {
      updateConnectionMutation.mutate({ connectionId, settings });
    },
    [updateConnectionMutation],
  );

  const setConnectionPrimary = useCallback(
    (connectionId: string) => {
      updateConnectionMutation.mutate({ connectionId, settings: { isPrimary: true } });
    },
    [updateConnectionMutation],
  );

  const disconnect = useCallback(
    (connectionId: string) => {
      disconnectMutation.mutate(connectionId);
    },
    [disconnectMutation],
  );

  return {
    updateConnectionSettings,
    setConnectionPrimary,
    isUpdatingConnection: updateConnectionMutation.isPending,
    disconnect,
    isDisconnecting: disconnectMutation.isPending,
  };
}
