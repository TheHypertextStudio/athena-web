'use client';

/**
 * Calendar connections list component.
 *
 * Handles the multi-account UI for calendar integrations:
 * - Connection cards with sync/rename/disconnect actions
 * - Add another connection button
 * - Edit connection label dialog
 */

import { useState } from 'react';
import type { CalendarConnection, CalendarProvider } from '@/lib/api-client';
import { CalendarConnectionCard } from './calendar-connection-card';
import { ConnectCalendarButton } from './connect-calendar-button';
import { EditConnectionLabelDialog } from './edit-connection-label-dialog';

/** Provider display name mapping */
const PROVIDER_DISPLAY_NAMES: Record<CalendarProvider, string> = {
  google: 'Google',
  outlook: 'Microsoft',
  icloud: 'Apple',
  caldav: 'CalDAV',
};

interface CalendarConnectionsListProps {
  /** Calendar provider type */
  provider: CalendarProvider;
  /** List of connections for this provider */
  connections: CalendarConnection[];
  /** ID of connection currently syncing */
  syncingConnectionId: string | null;
  /** Whether a disconnect is in progress */
  isDisconnecting: boolean;
  /** Whether a connection update is in progress */
  isUpdatingConnection: boolean;
  /** Callback to sync a connection */
  onSync: (connectionId: string) => void;
  /** Callback to disconnect a connection */
  onDisconnect: (connectionId: string) => void;
  /** Callback to set a connection as primary */
  onSetPrimary: (connectionId: string) => void;
  /** Callback to update connection settings */
  onUpdateSettings: (connectionId: string, settings: { accountLabel?: string }) => void;
  /** Callback when calendar settings change */
  onCalendarUpdate: () => void;
}

/**
 * Multi-account UI for calendar integrations.
 * Displays connection cards, connect button, and edit label dialog.
 *
 * @param props - Calendar connections list props.
 */
export function CalendarConnectionsList({
  provider,
  connections,
  syncingConnectionId,
  isDisconnecting,
  isUpdatingConnection,
  onSync,
  onDisconnect,
  onSetPrimary,
  onUpdateSettings,
  onCalendarUpdate,
}: CalendarConnectionsListProps) {
  // Edit label dialog state
  const [editLabelDialogOpen, setEditLabelDialogOpen] = useState(false);
  const [editConnectionId, setEditConnectionId] = useState<string | null>(null);
  const [editCurrentLabel, setEditCurrentLabel] = useState<string | null>(null);
  const [editConnectionEmail, setEditConnectionEmail] = useState<string | null>(null);

  const handleEditLabel = (
    connectionId: string,
    currentLabel: string | null,
    email: string | null,
  ) => {
    setEditConnectionId(connectionId);
    setEditCurrentLabel(currentLabel);
    setEditConnectionEmail(email);
    setEditLabelDialogOpen(true);
  };

  const handleEditLabelSubmit = (newLabel: string) => {
    if (editConnectionId) {
      onUpdateSettings(editConnectionId, { accountLabel: newLabel || undefined });
      setEditLabelDialogOpen(false);
    }
  };

  if (connections.length === 0) {
    return null;
  }

  return (
    <>
      <div>
        <h3 className="text-on-surface mb-3 font-medium">
          Connected Accounts ({connections.length})
        </h3>
        <div className="space-y-3">
          {connections.map((conn) => (
            <CalendarConnectionCard
              key={conn.id}
              connection={conn}
              onSync={() => {
                onSync(conn.id);
              }}
              onDisconnect={() => {
                onDisconnect(conn.id);
              }}
              onRename={() => {
                handleEditLabel(conn.id, conn.accountLabel, conn.accountEmail);
              }}
              onSetPrimary={() => {
                onSetPrimary(conn.id);
              }}
              onCalendarUpdate={onCalendarUpdate}
              isSyncing={syncingConnectionId === conn.id}
              isDisconnecting={isDisconnecting}
            />
          ))}
        </div>

        {/* Add Another Connection button */}
        <div className="mt-4">
          <ConnectCalendarButton
            provider={provider}
            providerName={PROVIDER_DISPLAY_NAMES[provider]}
            existingAccountCount={connections.length}
            onConnected={onCalendarUpdate}
          />
        </div>
      </div>

      <EditConnectionLabelDialog
        open={editLabelDialogOpen}
        onOpenChange={setEditLabelDialogOpen}
        currentLabel={editCurrentLabel}
        connectionEmail={editConnectionEmail}
        onSave={handleEditLabelSubmit}
        isLoading={isUpdatingConnection}
      />
    </>
  );
}
