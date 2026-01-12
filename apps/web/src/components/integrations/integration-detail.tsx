'use client';

/**
 * Shared integration detail content component.
 *
 * Used by both the modal and full-page detail views.
 * Handles both standard integrations and calendar-specific integrations.
 * Supports multiple accounts per provider for calendar integrations.
 */

import { useState } from 'react';
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useIntegrations } from '@/hooks/use-integrations';
import { useCalendarSync } from '@/hooks/useCalendarSync';
import { getIntegrationConfig, CATEGORY_INFO } from '@/lib/integrations';
import { calendarSyncApi, type CalendarProvider } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Surface } from '@/components/ui/surface';
import { IntegrationIcon } from './integration-icons';
import { AccountCard } from './account-card';
import { AddAccountButton } from './add-account-button';
import { RenameAccountDialog } from './rename-account-dialog';

/** Calendar provider identifiers */
const CALENDAR_PROVIDERS = ['google_calendar', 'outlook_calendar', 'apple_calendar'] as const;
type CalendarProviderType = (typeof CALENDAR_PROVIDERS)[number];

/** Map integration provider to calendar-sync provider */
const CALENDAR_PROVIDER_MAP: Record<CalendarProviderType, CalendarProvider> = {
  google_calendar: 'google',
  outlook_calendar: 'outlook',
  apple_calendar: 'icloud',
};

function isCalendarProvider(provider: string): provider is CalendarProviderType {
  return CALENDAR_PROVIDERS.includes(provider as CalendarProviderType);
}

interface IntegrationDetailContentProps {
  provider: string;
}

/** Provider display name mapping */
const PROVIDER_DISPLAY_NAMES: Record<CalendarProvider, string> = {
  google: 'Google',
  outlook: 'Microsoft',
  icloud: 'Apple',
  caldav: 'CalDAV',
};

/**
 * Detail content for an integration.
 * Shows description, scopes, connection status, and connect/disconnect actions.
 * For calendar providers, shows multi-account UI with individual account cards.
 */
export function IntegrationDetailContent({ provider }: IntegrationDetailContentProps) {
  const config = getIntegrationConfig(provider);
  const { integrations, isLoading, connect, isConnecting, disconnect, isDisconnecting } =
    useIntegrations();
  const {
    connectionsByProvider,
    isLoading: isLoadingCalendar,
    syncConnection,
    syncingConnectionId,
    updateAccountSettings,
    setAccountPrimary,
    disconnect: disconnectCalendar,
    isDisconnecting: isDisconnectingCalendar,
    isUpdatingAccount,
    refetch: refetchCalendar,
  } = useCalendarSync();

  // Rename dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameConnectionId, setRenameConnectionId] = useState<string | null>(null);
  const [renameCurrentLabel, setRenameCurrentLabel] = useState<string | null>(null);
  const [renameAccountEmail, setRenameAccountEmail] = useState<string | null>(null);

  const isCalendar = isCalendarProvider(provider);
  const calendarProvider = isCalendar ? CALENDAR_PROVIDER_MAP[provider] : null;

  if (!config) {
    return (
      <div className="py-8 text-center">
        <p className="text-on-surface-variant">Integration not found.</p>
      </div>
    );
  }

  if (isLoading || (isCalendar && isLoadingCalendar)) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-12 w-12 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  // For calendar providers, get all connections for this provider
  const calendarConnections =
    isCalendar && calendarProvider ? connectionsByProvider[calendarProvider] : [];

  // For non-calendar providers, use the standard integrations
  const connection = isCalendar ? null : integrations.find((i) => i.provider === provider);

  const isConnected = isCalendar ? calendarConnections.length > 0 : !!connection;
  const categoryInfo = CATEGORY_INFO[config.category];

  const handleConnect = async () => {
    if (isCalendar && calendarProvider) {
      // Use calendar-sync OAuth flow
      try {
        const result = await calendarSyncApi.getAuthUrl(calendarProvider);
        if (result.data.authUrl) {
          window.location.href = result.data.authUrl;
        }
      } catch (err) {
        console.error('Failed to get calendar auth URL:', err);
      }
    } else {
      // Use standard integrations OAuth flow
      connect({
        provider: config.provider,
        redirectUri: `${window.location.origin}/settings/integrations/detail/${config.provider}`,
      });
    }
  };

  const handleDisconnectNonCalendar = () => {
    const name = config.name;
    if (!confirm(`Are you sure you want to disconnect ${name}?`)) {
      return;
    }
    if (connection) {
      disconnect(connection.id);
    }
  };

  const handleRename = (
    connectionId: string,
    currentLabel: string | null,
    email: string | null,
  ) => {
    setRenameConnectionId(connectionId);
    setRenameCurrentLabel(currentLabel);
    setRenameAccountEmail(email);
    setRenameDialogOpen(true);
  };

  const handleRenameSubmit = (newLabel: string) => {
    if (renameConnectionId) {
      updateAccountSettings(renameConnectionId, { accountLabel: newLabel || undefined });
      setRenameDialogOpen(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Surface
          elevation="high"
          padding="none"
          rounded="md"
          className="flex h-12 w-12 shrink-0 items-center justify-center"
        >
          <IntegrationIcon provider={config.provider} size={24} />
        </Surface>
        <div className="min-w-0 flex-1">
          <h2 className="text-on-surface text-xl font-semibold">{config.name}</h2>
          <Badge variant="outline" className="mt-1">
            {categoryInfo.name}
          </Badge>
        </div>
      </div>

      {/* Description */}
      <div>
        <p className="text-on-surface-variant">{config.description}</p>
      </div>

      {/* Calendar Multi-Account UI */}
      {isCalendar && calendarProvider && (
        <>
          {calendarConnections.length > 0 && (
            <div>
              <h3 className="text-on-surface mb-3 font-medium">
                Connected Accounts ({calendarConnections.length})
              </h3>
              <div className="space-y-3">
                {calendarConnections.map((conn) => (
                  <AccountCard
                    key={conn.id}
                    connection={conn}
                    onSync={() => {
                      syncConnection(conn.id);
                    }}
                    onDisconnect={() => {
                      disconnectCalendar(conn.id);
                    }}
                    onRename={() => {
                      handleRename(conn.id, conn.accountLabel, conn.accountEmail);
                    }}
                    onSetPrimary={() => {
                      setAccountPrimary(conn.id);
                    }}
                    onCalendarUpdate={refetchCalendar}
                    isSyncing={syncingConnectionId === conn.id}
                    isDisconnecting={isDisconnectingCalendar}
                  />
                ))}
              </div>

              {/* Add Another Account button */}
              <div className="mt-4">
                <AddAccountButton
                  provider={calendarProvider}
                  providerName={PROVIDER_DISPLAY_NAMES[calendarProvider]}
                  existingAccountCount={calendarConnections.length}
                />
              </div>
            </div>
          )}

          {/* Show connect button when no connections exist */}
          {calendarConnections.length === 0 && (
            <Button
              variant="filled"
              onClick={() => {
                void handleConnect();
              }}
              disabled={isConnecting}
              className="w-full"
            >
              <LinkOutlinedIcon sx={{ fontSize: 18 }} className="mr-2" />
              {isConnecting ? 'Connecting...' : 'Connect'}
            </Button>
          )}
        </>
      )}

      {/* Non-Calendar Connection Status */}
      {!isCalendar && isConnected && connection && (
        <div className="bg-tertiary-container/30 rounded-xl p-4">
          <div className="text-tertiary flex items-center gap-2">
            <CheckCircleOutlinedIcon sx={{ fontSize: 20 }} />
            <span className="font-medium">Connected</span>
          </div>
          <div className="text-on-surface-variant mt-2 space-y-1 text-sm">
            <p>
              Connected on{' '}
              {new Date(connection.createdAt).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
          </div>
        </div>
      )}

      {/* Scopes */}
      <div>
        <h3 className="text-on-surface mb-3 flex items-center gap-2 font-medium">
          <LockOutlinedIcon sx={{ fontSize: 18 }} />
          Permissions
        </h3>
        <div className="space-y-2">
          {config.scopes.map((scope) => (
            <Surface key={scope.id} elevation="high" padding="sm" rounded="sm">
              <div className="text-on-surface font-medium">{scope.name}</div>
              <div className="text-on-surface-variant text-sm">{scope.description}</div>
            </Surface>
          ))}
        </div>
      </div>

      {/* Non-Calendar Action Buttons */}
      {!isCalendar && (
        <div className="space-y-2 pt-2">
          {isConnected ? (
            <Button
              variant="outlined"
              onClick={handleDisconnectNonCalendar}
              disabled={isDisconnecting}
              className="w-full"
            >
              {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          ) : (
            <Button
              variant="filled"
              onClick={() => {
                void handleConnect();
              }}
              disabled={isConnecting}
              className="w-full"
            >
              <LinkOutlinedIcon sx={{ fontSize: 18 }} className="mr-2" />
              {isConnecting ? 'Connecting...' : 'Connect'}
            </Button>
          )}
        </div>
      )}

      {/* Rename Account Dialog */}
      <RenameAccountDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        currentLabel={renameCurrentLabel}
        accountEmail={renameAccountEmail}
        onRename={handleRenameSubmit}
        isLoading={isUpdatingAccount}
      />
    </div>
  );
}
