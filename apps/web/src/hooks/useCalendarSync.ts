/**
 * Calendar sync hook for managing Google Calendar and other provider integrations.
 *
 * Provides:
 * - Connection management (list, sync, push)
 * - Auto-sync on page load
 * - Push mutations for bidirectional sync
 *
 * @packageDocumentation
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useCallback, useRef, useMemo } from 'react';
import {
  calendarSyncApi,
  calendarSyncKeys,
  eventKeys,
  type CalendarConnection,
  type CalendarProvider,
  type AccountSettingsUpdate,
} from '@/lib/api-client';

export interface UseCalendarSyncReturn {
  /** List of calendar connections */
  connections: CalendarConnection[];
  /** Connections grouped by provider */
  connectionsByProvider: Record<CalendarProvider, CalendarConnection[]>;
  /** Whether there are any active connections */
  hasConnections: boolean;
  /** Connections configured for bidirectional sync */
  bidirectionalConnections: CalendarConnection[];
  /** Loading state for connections query */
  isLoading: boolean;
  /** Error from connections query */
  error: Error | null;

  // Sync operations
  /** Sync all connections */
  syncAll: () => void;
  /** Sync a specific connection */
  syncConnection: (connectionId: string) => void;
  /** Whether a sync is in progress */
  isSyncing: boolean;
  /** ID of connection currently syncing (if any) */
  syncingConnectionId: string | null;

  // Event sync operations
  /** Sync an event (create/update) to all bidirectional connections */
  syncEvent: (eventId: string) => void;
  /** Delete an event from all bidirectional connections */
  deleteEvent: (eventId: string) => void;
  /** Whether an event sync operation is in progress */
  isSyncingEvent: boolean;

  // Account management
  /** Update account settings (label, color, primary status) */
  updateAccountSettings: (connectionId: string, settings: AccountSettingsUpdate) => void;
  /** Set an account as primary */
  setAccountPrimary: (connectionId: string) => void;
  /** Whether an account update is in progress */
  isUpdatingAccount: boolean;

  // Disconnect
  /** Disconnect a calendar connection */
  disconnect: (connectionId: string) => void;
  /** Whether a disconnect is in progress */
  isDisconnecting: boolean;

  // Manual refetch
  /** Refetch connections */
  refetch: () => void;
}

/**
 * Hook for managing calendar sync state and operations.
 */
export function useCalendarSync(): UseCalendarSyncReturn {
  const queryClient = useQueryClient();

  // Fetch connections
  const connectionsQuery = useQuery({
    queryKey: calendarSyncKeys.connections(),
    queryFn: async () => {
      const response = await calendarSyncApi.getConnections();
      return response.data;
    },
    staleTime: 60_000, // 1 minute
  });

  // Sync all mutation
  const syncAllMutation = useMutation({
    mutationFn: () => calendarSyncApi.syncAll(),
    onSuccess: () => {
      // Invalidate events to refetch synced data
      void queryClient.invalidateQueries({ queryKey: eventKeys.lists() });
    },
  });

  // Single connection sync
  const syncConnectionMutation = useMutation({
    mutationFn: (connectionId: string) => calendarSyncApi.triggerSync(connectionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: eventKeys.lists() });
    },
  });

  // Sync event (create/update) mutation
  const syncEventMutation = useMutation({
    mutationFn: (eventId: string) => calendarSyncApi.syncEventToAll(eventId),
  });

  // Delete event mutation
  const deleteEventMutation = useMutation({
    mutationFn: (eventId: string) => calendarSyncApi.deleteEventFromAll(eventId),
  });

  // Update account settings mutation
  const updateAccountMutation = useMutation({
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

  const connections = connectionsQuery.data ?? [];
  const hasConnections = connections.length > 0;

  // Group connections by provider
  const connectionsByProvider = useMemo(() => {
    const grouped: Record<CalendarProvider, CalendarConnection[]> = {
      google: [],
      outlook: [],
      icloud: [],
      caldav: [],
    };

    for (const connection of connections) {
      grouped[connection.provider].push(connection);
    }

    return grouped;
  }, [connections]);

  // Filter for bidirectional connections
  const bidirectionalConnections = connections.filter((c) =>
    c.calendars.some((cal) => cal.syncEnabled && cal.syncDirection === 'bidirectional'),
  );

  // Track which connection is currently syncing
  const syncingConnectionId = syncConnectionMutation.isPending
    ? syncConnectionMutation.variables
    : null;

  const syncAll = useCallback(() => {
    syncAllMutation.mutate();
  }, [syncAllMutation]);

  const syncConnection = useCallback(
    (connectionId: string) => {
      syncConnectionMutation.mutate(connectionId);
    },
    [syncConnectionMutation],
  );

  const syncEvent = useCallback(
    (eventId: string) => {
      if (bidirectionalConnections.length > 0) {
        syncEventMutation.mutate(eventId);
      }
    },
    [bidirectionalConnections.length, syncEventMutation],
  );

  const deleteEvent = useCallback(
    (eventId: string) => {
      if (bidirectionalConnections.length > 0) {
        deleteEventMutation.mutate(eventId);
      }
    },
    [bidirectionalConnections.length, deleteEventMutation],
  );

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: calendarSyncKeys.connections() });
  }, [queryClient]);

  const updateAccountSettings = useCallback(
    (connectionId: string, settings: AccountSettingsUpdate) => {
      updateAccountMutation.mutate({ connectionId, settings });
    },
    [updateAccountMutation],
  );

  const setAccountPrimary = useCallback(
    (connectionId: string) => {
      updateAccountMutation.mutate({ connectionId, settings: { isPrimary: true } });
    },
    [updateAccountMutation],
  );

  const disconnect = useCallback(
    (connectionId: string) => {
      disconnectMutation.mutate(connectionId);
    },
    [disconnectMutation],
  );

  return {
    connections,
    connectionsByProvider,
    hasConnections,
    bidirectionalConnections,
    isLoading: connectionsQuery.isLoading,
    error: connectionsQuery.error,

    syncAll,
    syncConnection,
    isSyncing: syncAllMutation.isPending || syncConnectionMutation.isPending,
    syncingConnectionId,

    syncEvent,
    deleteEvent,
    isSyncingEvent: syncEventMutation.isPending || deleteEventMutation.isPending,

    updateAccountSettings,
    setAccountPrimary,
    isUpdatingAccount: updateAccountMutation.isPending,

    disconnect,
    isDisconnecting: disconnectMutation.isPending,

    refetch,
  };
}

/**
 * Hook to automatically sync calendar on mount.
 * Only syncs once per page load to avoid excessive API calls.
 */
export function useAutoCalendarSync(): void {
  const { hasConnections, syncAll, isSyncing } = useCalendarSync();
  const hasSynced = useRef(false);

  useEffect(() => {
    // Only sync once on mount, and only if we have connections
    if (hasConnections && !isSyncing && !hasSynced.current) {
      hasSynced.current = true;
      syncAll();
    }
  }, [hasConnections, isSyncing, syncAll]);
}

/**
 * Hook that provides sync callbacks for calendar operations.
 * Returns stable callbacks that can be used in useCalendarData.
 */
export function useCalendarPush() {
  const { bidirectionalConnections, syncEvent, deleteEvent } = useCalendarSync();

  const hasBidirectionalSync = bidirectionalConnections.length > 0;

  return {
    hasBidirectionalSync,
    /** Sync event to external calendars (create or update) */
    syncEvent,
    /** Delete event from external calendars */
    deleteEvent,
  };
}
