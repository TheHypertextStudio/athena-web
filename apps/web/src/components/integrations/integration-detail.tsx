'use client';

/**
 * Shared integration detail content component.
 *
 * Used by both the modal and full-page detail views.
 * Handles both standard integrations and calendar-specific integrations.
 */

import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useIntegrations } from '@/hooks/use-integrations';
import { useCalendarSync } from '@/hooks/useCalendarSync';
import { getIntegrationConfig, CATEGORY_INFO } from '@/lib/integrations';
import type { CalendarProvider } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Surface } from '@/components/ui/surface';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { IntegrationIcon } from './integration-icons';
import { CalendarConnectionsList } from './calendar-connections-list';
import { ConnectCalendarButton } from './connect-calendar-button';

/** Calendar provider identifiers */
const CALENDAR_PROVIDERS = [
  'google_calendar',
  'outlook_calendar',
  'apple_calendar',
  'caldav_calendar',
] as const;
type CalendarProviderType = (typeof CALENDAR_PROVIDERS)[number];

/** Map integration provider to calendar-sync provider */
const CALENDAR_PROVIDER_MAP: Record<CalendarProviderType, CalendarProvider> = {
  google_calendar: 'google',
  outlook_calendar: 'outlook',
  apple_calendar: 'icloud',
  caldav_calendar: 'caldav',
};

const CALENDAR_PROVIDER_LABELS: Record<CalendarProvider, string> = {
  google: 'Google',
  outlook: 'Microsoft',
  icloud: 'Apple',
  caldav: 'CalDAV',
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
 * For calendar providers, delegates to CalendarIntegrationAccounts component.
 *
 * @param props - Integration detail props.
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
    updateConnectionSettings,
    setConnectionPrimary,
    disconnect: disconnectCalendar,
    isDisconnecting: isDisconnectingCalendar,
    isUpdatingConnection,
    refetch: refetchCalendar,
  } = useCalendarSync();

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

  const handleConnect = () => {
    connect({
      provider: config.provider,
      redirectUri: `${window.location.origin}/settings/integrations/detail/${config.provider}`,
    });
  };

  const handleDisconnectNonCalendar = () => {
    if (connection) {
      disconnect(connection.id);
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
          <CalendarConnectionsList
            provider={calendarProvider}
            connections={calendarConnections}
            syncingConnectionId={syncingConnectionId}
            isDisconnecting={isDisconnectingCalendar}
            isUpdatingConnection={isUpdatingConnection}
            onSync={syncConnection}
            onDisconnect={disconnectCalendar}
            onSetPrimary={setConnectionPrimary}
            onUpdateSettings={updateConnectionSettings}
            onCalendarUpdate={refetchCalendar}
          />

          {/* Show connect button when no connections exist */}
          {calendarConnections.length === 0 && (
            <ConnectCalendarButton
              provider={calendarProvider}
              providerName={CALENDAR_PROVIDER_LABELS[calendarProvider]}
              existingAccountCount={0}
              label={`Connect ${CALENDAR_PROVIDER_LABELS[calendarProvider]} Account`}
              onConnected={refetchCalendar}
            />
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
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outlined" disabled={isDisconnecting} className="w-full">
                  {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Disconnect {config.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will remove the integration from your account.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDisconnecting}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDisconnectNonCalendar}
                    disabled={isDisconnecting}
                  >
                    Disconnect
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <Button
              variant="filled"
              onClick={handleConnect}
              disabled={isConnecting}
              className="w-full"
            >
              <LinkOutlinedIcon sx={{ fontSize: 18 }} className="mr-2" />
              {isConnecting ? 'Connecting...' : 'Connect'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
