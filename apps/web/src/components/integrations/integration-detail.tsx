'use client';

/**
 * Shared integration detail content component.
 *
 * Used by both the modal and full-page detail views.
 * Handles both standard integrations and calendar-specific integrations.
 */

import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';
import LinkOffOutlinedIcon from '@mui/icons-material/LinkOffOutlined';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import SyncOutlinedIcon from '@mui/icons-material/SyncOutlined';
import { useIntegrations } from '@/hooks/use-integrations';
import { useCalendarSync } from '@/hooks/useCalendarSync';
import { getIntegrationConfig, CATEGORY_INFO } from '@/lib/integrations';
import { calendarSyncApi, type CalendarProvider } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Surface } from '@/components/ui/surface';
import { IntegrationIcon } from './integration-icons';
import { CalendarSelection } from './calendar-selection';

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

/**
 * Detail content for an integration.
 * Shows description, scopes, connection status, and connect/disconnect actions.
 * For calendar providers, also shows calendar selection and sync status.
 */
export function IntegrationDetailContent({ provider }: IntegrationDetailContentProps) {
  const config = getIntegrationConfig(provider);
  const { integrations, isLoading, connect, isConnecting, disconnect, isDisconnecting } =
    useIntegrations();
  const {
    connections: calendarConnections,
    isLoading: isLoadingCalendar,
    syncConnection,
    isSyncing,
    refetch: refetchCalendar,
  } = useCalendarSync();

  const isCalendar = isCalendarProvider(provider);

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

  // For calendar providers, find the connection in calendarConnections
  const calendarConnection = isCalendar
    ? calendarConnections.find((c) => c.provider === CALENDAR_PROVIDER_MAP[provider])
    : null;

  // For non-calendar providers, use the standard integrations
  const connection = isCalendar ? null : integrations.find((i) => i.provider === provider);

  const isConnected = isCalendar ? !!calendarConnection : !!connection;
  const categoryInfo = CATEGORY_INFO[config.category];

  const handleConnect = async () => {
    if (isCalendar) {
      // Use calendar-sync OAuth flow
      const calendarProvider = CALENDAR_PROVIDER_MAP[provider];
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

  const handleDisconnect = async () => {
    const name = config.name;
    if (!confirm(`Are you sure you want to disconnect ${name}?`)) {
      return;
    }

    if (isCalendar && calendarConnection) {
      try {
        await calendarSyncApi.disconnect(calendarConnection.id);
        refetchCalendar();
      } catch (err) {
        console.error('Failed to disconnect calendar:', err);
      }
    } else if (connection) {
      disconnect(connection.id);
    }
  };

  const handleSync = () => {
    if (calendarConnection) {
      syncConnection(calendarConnection.id);
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

      {/* Connection Status */}
      {isConnected && (
        <div className="bg-tertiary-container/30 rounded-xl p-4">
          <div className="text-tertiary flex items-center gap-2">
            <CheckCircleOutlinedIcon sx={{ fontSize: 20 }} />
            <span className="font-medium">Connected</span>
          </div>
          <div className="text-on-surface-variant mt-2 space-y-1 text-sm">
            {connection && (
              <p>
                Connected on{' '}
                {new Date(connection.createdAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            )}
            {/* Calendar-specific status */}
            {calendarConnection && (
              <>
                <p>
                  Connected on{' '}
                  {new Date(calendarConnection.createdAt).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
                {calendarConnection.lastSyncAt && (
                  <p>
                    Last synced:{' '}
                    {new Date(calendarConnection.lastSyncAt).toLocaleString(undefined, {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                    {calendarConnection.lastSyncStatus === 'error' && (
                      <span className="text-error ml-1">(sync failed)</span>
                    )}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Calendar Selection (for calendar providers when connected) */}
      {isCalendar && calendarConnection && (
        <CalendarSelection
          connectionId={calendarConnection.id}
          calendars={calendarConnection.calendars}
          onUpdate={refetchCalendar}
        />
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

      {/* Action Buttons */}
      <div className="space-y-2 pt-2">
        {isConnected ? (
          <>
            {/* Sync button for calendar providers */}
            {isCalendar && calendarConnection && (
              <Button variant="filled" onClick={handleSync} disabled={isSyncing} className="w-full">
                <SyncOutlinedIcon
                  sx={{ fontSize: 18 }}
                  className={`mr-2 ${isSyncing ? 'animate-spin' : ''}`}
                />
                {isSyncing ? 'Syncing...' : 'Sync Now'}
              </Button>
            )}
            {/* Disconnect button */}
            <Button
              variant="outlined"
              onClick={() => {
                void handleDisconnect();
              }}
              disabled={isDisconnecting}
              className="w-full"
            >
              <LinkOffOutlinedIcon sx={{ fontSize: 18 }} className="mr-2" />
              {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          </>
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
    </div>
  );
}
