/**
 * Calendar sync hook for managing Google Calendar and other provider integrations.
 *
 * Provides:
 * - Connection listing and grouping
 * - Sync operations (all, per-connection, per-event)
 * - Auto-sync on page load
 *
 * For connection management (rename, set primary, disconnect),
 * use the composed useCalendarConnectionActions hook.
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
import { useCalendarConnectionActions } from './useCalendarConnectionActions';

export interface UseCalendarSyncReturn {
  /** List of calendar connections */
  connections: CalendarConnection[];
  /** Connections grouped by provider */
  connectionsByProvider: Record<CalendarProvider, CalendarConnection[]>;
  /** Whether there are any active connections */
  hasConnections: boolean;
  /** Connections configured to push events externally */
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
  /** Sync an event (create/update) to all push-enabled connections */
  syncEvent: (eventId: string) => void;
  /** Delete an event from all push-enabled connections */
  deleteEvent: (eventId: string) => void;
  /** Whether an event sync operation is in progress */
  isSyncingEvent: boolean;

  // Connection management (delegated to useCalendarConnectionActions)
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

  // Manual refetch
  /** Refetch connections */
  refetch: () => void;
}

/**
 * Hook for managing calendar sync state and operations.
 * Composes useCalendarConnectionActions for connection management.
 */
export function useCalendarSync(): UseCalendarSyncReturn {
  const queryClient = useQueryClient();

  // Compose connection actions hook
  const connectionActions = useCalendarConnectionActions();

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
      void queryClient.invalidateQueries({ queryKey: eventKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: calendarSyncKeys.connections() });
    },
  });

  // Single connection sync
  const syncConnectionMutation = useMutation({
    mutationFn: (connectionId: string) => calendarSyncApi.triggerSync(connectionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: eventKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: calendarSyncKeys.connections() });
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

  // Filter for push-enabled connections
  const bidirectionalConnections = useMemo(
    () =>
      connections.filter((c) =>
        c.calendars.some(
          (cal) =>
            cal.syncEnabled &&
            (cal.syncDirection === 'bidirectional' || cal.syncDirection === 'push'),
        ),
      ),
    [connections],
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

    // Spread connection actions
    ...connectionActions,

    refetch,
  };
}

/**
 * Hook to automatically sync calendar on mount.
 * Only syncs once per page load to avoid excessive API calls.
 */
export function useAutoCalendarSync(): void {
  const { hasConnections, syncAll, isSyncing, connections } = useCalendarSync();
  const hasSynced = useRef(false);

  useEffect(() => {
    const recentSyncThresholdMs = 2 * 60 * 1000;
    const now = Date.now();
    const recentlySynced = connections.some((connection) => {
      if (!connection.lastSyncAt) {
        return false;
      }
      const lastSyncTime = Date.parse(connection.lastSyncAt);
      return Number.isFinite(lastSyncTime) && now - lastSyncTime < recentSyncThresholdMs;
    });

    // Only sync once on mount, and only if we have connections
    if (hasConnections && !isSyncing && !hasSynced.current && !recentlySynced) {
      hasSynced.current = true;
      syncAll();
    }
  }, [connections, hasConnections, isSyncing, syncAll]);
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
