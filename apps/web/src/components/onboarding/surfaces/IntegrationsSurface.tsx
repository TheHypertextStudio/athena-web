/**
 * Integrations surface for step 2 of onboarding.
 *
 * Guides user through connecting calendar integrations:
 * - Shows suggested integrations based on intent
 * - Handles OAuth connection flow
 * - Displays sync status
 *
 * @packageDocumentation
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import SyncIcon from '@mui/icons-material/Sync';
import CloseIcon from '@mui/icons-material/Close';
import {
  useOnboardingStore,
  type IntegrationEntry,
  type IntegrationStatus,
} from '@/lib/onboarding';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { calendarSyncApi, type CalendarProvider } from '@/lib/api-client';
import { useCalendarSync } from '@/hooks/useCalendarSync';
import { ONBOARDING_TEST_IDS } from '../test-ids';

/**
 * Provider metadata for display purposes.
 */
const PROVIDER_INFO: Record<string, { name: string; icon: string; color: string }> = {
  google_calendar: {
    name: 'Google Calendar',
    icon: '📅',
    color: 'bg-blue-50',
  },
  outlook_calendar: {
    name: 'Outlook Calendar',
    icon: '📆',
    color: 'bg-sky-50',
  },
  apple_calendar: {
    name: 'iCloud Calendar',
    icon: '🍎',
    color: 'bg-gray-50',
  },
  linear: {
    name: 'Linear',
    icon: '⚡',
    color: 'bg-purple-50',
  },
  github: {
    name: 'GitHub',
    icon: '🐙',
    color: 'bg-slate-50',
  },
};

/**
 * Map UI provider names to API provider names.
 */
const UI_TO_API_PROVIDER: Record<string, CalendarProvider | null> = {
  google_calendar: 'google',
  outlook_calendar: 'outlook',
  apple_calendar: 'icloud',
  linear: null, // Not a calendar provider
  github: null, // Not a calendar provider
};

/**
 * Map API provider names back to UI provider names.
 */
const API_TO_UI_PROVIDER: Record<CalendarProvider, string> = {
  google: 'google_calendar',
  outlook: 'outlook_calendar',
  icloud: 'apple_calendar',
  caldav: 'caldav',
};

/**
 * All available providers (for the drawer).
 */
const ALL_PROVIDERS = ['google_calendar', 'outlook_calendar', 'apple_calendar', 'linear', 'github'];

/**
 * IntegrationsSurface component for connecting integrations.
 */
export function IntegrationsSurface() {
  const [showAllIntegrations, setShowAllIntegrations] = useState(false);
  const { suggestedProviders, integrations, setIntegrationStatus, setIntegrationConnected } =
    useOnboardingStore();

  // Use the shared calendar sync hook for connection management
  const { connectionsByProvider, disconnect, refetch } = useCalendarSync();

  // Sync onboarding store with actual connections from useCalendarSync
  useEffect(() => {
    for (const [provider, conns] of Object.entries(connectionsByProvider)) {
      const uiProvider = API_TO_UI_PROVIDER[provider as CalendarProvider];
      if (uiProvider && conns.length > 0) {
        const connection = conns[0];
        if (connection) {
          const calendarCount = connection.calendars.filter((c) => c.syncEnabled).length;
          setIntegrationConnected(uiProvider, calendarCount);
        }
      }
    }
  }, [connectionsByProvider, setIntegrationConnected]);

  /**
   * Check for new connections after OAuth popup closes.
   * Uses the shared hook's refetch to update connection state.
   */
  const checkForConnections = useCallback(
    async (uiProvider: string): Promise<boolean> => {
      // Refetch connections using the shared hook
      refetch();

      // Wait a moment for the query to update
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });

      const apiProvider = UI_TO_API_PROVIDER[uiProvider];
      if (!apiProvider) return false;

      const providerConnections = connectionsByProvider[apiProvider];
      const connection = providerConnections[0];
      if (connection) {
        const calendarCount = connection.calendars.filter((c) => c.syncEnabled).length;
        setIntegrationConnected(uiProvider, calendarCount);
        return true;
      }
      return false;
    },
    [connectionsByProvider, refetch, setIntegrationConnected],
  );

  /**
   * Connect to a calendar provider via OAuth.
   * Uses popup for onboarding flow to keep user on the page.
   */
  const handleConnect = useCallback(
    async (uiProvider: string) => {
      const apiProvider = UI_TO_API_PROVIDER[uiProvider];

      if (!apiProvider) {
        // Non-calendar integrations (Linear, GitHub) not yet implemented
        setIntegrationStatus(uiProvider, 'error', 'This integration is coming soon.');
        return;
      }

      setIntegrationStatus(uiProvider, 'connecting');

      try {
        // Get OAuth URL using the same API as settings
        const response = await calendarSyncApi.getAuthUrl(apiProvider);

        if (!response.data.authUrl) {
          throw new Error('Could not get authorization URL');
        }

        // Open OAuth popup (onboarding uses popup to keep user on page)
        const popup = window.open(response.data.authUrl, 'oauth', 'width=600,height=700,popup=yes');

        if (!popup) {
          throw new Error('Popup was blocked. Please allow popups for this site.');
        }

        // Poll for popup close
        const pollTimer = setInterval(() => {
          if (popup.closed) {
            clearInterval(pollTimer);

            // Check for successful connection
            setIntegrationStatus(uiProvider, 'syncing');

            void (async () => {
              const connected = await checkForConnections(uiProvider);

              if (!connected) {
                // User might have cancelled or closed the popup
                setIntegrationStatus(uiProvider, 'idle');
              }
            })();
          }
        }, 500);

        // Timeout after 5 minutes
        setTimeout(
          () => {
            clearInterval(pollTimer);
            if (!popup.closed) {
              popup.close();
              setIntegrationStatus(uiProvider, 'error', 'Connection timed out. Please try again.');
            }
          },
          5 * 60 * 1000,
        );
      } catch (error) {
        setIntegrationStatus(
          uiProvider,
          'error',
          error instanceof Error ? error.message : 'Connection failed. Please try again.',
        );
      }
    },
    [setIntegrationStatus, checkForConnections],
  );

  /**
   * Disconnect a calendar integration using the shared hook.
   */
  const handleDisconnect = useCallback(
    (uiProvider: string) => {
      const apiProvider = UI_TO_API_PROVIDER[uiProvider];
      if (!apiProvider) {
        setIntegrationStatus(uiProvider, 'error', 'Cannot disconnect this integration.');
        return;
      }

      const providerConnections = connectionsByProvider[apiProvider];
      const connection = providerConnections[0];
      if (!connection) {
        setIntegrationStatus(uiProvider, 'error', 'No connection found to disconnect.');
        return;
      }

      // Use the shared disconnect from useCalendarSync
      disconnect(connection.id);
      setIntegrationStatus(uiProvider, 'idle');
    },
    [connectionsByProvider, disconnect, setIntegrationStatus],
  );

  const handleRetry = useCallback(
    (provider: string) => {
      void handleConnect(provider);
    },
    [handleConnect],
  );

  const getIntegrationEntry = (provider: string): IntegrationEntry | undefined => {
    return integrations.find((i) => i.provider === provider);
  };

  return (
    <div className="mx-auto max-w-xl" data-testid={ONBOARDING_TEST_IDS.integrations.surface}>
      <h2 className="text-headline-small text-on-surface mb-2">Connect your calendars</h2>
      <p className="text-body-medium text-on-surface-variant mb-6">
        I&apos;ll sync your events to help organize your day. You can skip this and connect later.
      </p>

      {/* Integration cards */}
      <div className="space-y-3">
        {suggestedProviders.map((provider, index) => {
          const entry = getIntegrationEntry(provider);
          const info = PROVIDER_INFO[provider] ?? {
            name: provider,
            icon: '🔗',
            color: 'bg-gray-50',
          };

          return (
            <IntegrationCard
              key={provider}
              provider={provider}
              name={info.name}
              icon={info.icon}
              color={info.color}
              status={entry?.status ?? 'idle'}
              error={entry?.error ?? null}
              syncedCount={entry?.syncedEventsCount}
              onConnect={() => {
                void handleConnect(provider);
              }}
              onDisconnect={() => {
                handleDisconnect(provider);
              }}
              onRetry={() => {
                handleRetry(provider);
              }}
              delay={index * 0.1}
            />
          );
        })}
      </div>

      {/* View all integrations button */}
      <button
        type="button"
        onClick={() => {
          setShowAllIntegrations(true);
        }}
        className={cn(
          'text-body-medium text-on-surface-variant mt-4 w-full py-2 text-center',
          'hover:text-on-surface transition-colors',
        )}
      >
        View all integrations →
      </button>

      {/* Helper text */}
      <p
        className="text-body-small text-on-surface-variant mt-4 text-center"
        data-testid={ONBOARDING_TEST_IDS.integrations.privacyNote}
      >
        Your data stays private. We only read calendar events, never modify them.
      </p>

      {/* All integrations drawer */}
      <AllIntegrationsDrawer
        open={showAllIntegrations}
        onClose={() => {
          setShowAllIntegrations(false);
        }}
        getIntegrationEntry={getIntegrationEntry}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onRetry={handleRetry}
      />
    </div>
  );
}

interface IntegrationCardProps {
  provider: string;
  name: string;
  icon: string;
  color: string;
  status: IntegrationStatus;
  error: string | null;
  syncedCount?: number;
  onConnect: () => void;
  onDisconnect: () => void;
  onRetry: () => void;
  delay?: number;
}

function IntegrationCard({
  provider,
  name,
  icon,
  color,
  status,
  error,
  syncedCount,
  onConnect,
  onDisconnect,
  onRetry,
  delay = 0,
}: IntegrationCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay }}
      className={cn(
        'flex items-center gap-4 rounded-xl border p-4',
        'border-outline-variant bg-surface-container',
      )}
      data-testid={ONBOARDING_TEST_IDS.integrations.card(provider)}
      data-provider={provider}
      data-status={status}
    >
      {/* Provider icon */}
      <div className={cn('flex h-12 w-12 items-center justify-center rounded-lg text-2xl', color)}>
        {icon}
      </div>

      {/* Provider info */}
      <div className="flex-1">
        <p className="text-label-large text-on-surface">{name}</p>
        <StatusText status={status} error={error} syncedCount={syncedCount} provider={provider} />
      </div>

      {/* Action button */}
      <ActionButton
        status={status}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
        onRetry={onRetry}
        provider={provider}
      />
    </motion.div>
  );
}

interface StatusTextProps {
  status: IntegrationStatus;
  error: string | null;
  syncedCount?: number;
  provider: string;
}

function StatusText({ status, error, syncedCount, provider }: StatusTextProps) {
  switch (status) {
    case 'connecting':
      return (
        <p
          className="text-body-small text-on-surface-variant flex items-center gap-1"
          data-testid={ONBOARDING_TEST_IDS.integrations.status(provider)}
          data-status="connecting"
        >
          <SyncIcon sx={{ fontSize: 14 }} className="animate-spin" />
          Connecting...
        </p>
      );
    case 'syncing':
      return (
        <p
          className="text-body-small text-on-surface-variant flex items-center gap-1"
          data-testid={ONBOARDING_TEST_IDS.integrations.status(provider)}
          data-status="syncing"
        >
          <SyncIcon sx={{ fontSize: 14 }} className="animate-spin" />
          Syncing events...
        </p>
      );
    case 'success':
      return (
        <p
          className="text-body-small text-primary flex items-center gap-1"
          data-testid={ONBOARDING_TEST_IDS.integrations.status(provider)}
          data-status="success"
        >
          <CheckCircleIcon sx={{ fontSize: 14 }} />
          Connected
          {syncedCount !== undefined &&
            syncedCount > 0 &&
            ` · ${String(syncedCount)} calendar${syncedCount === 1 ? '' : 's'}`}
        </p>
      );
    case 'error':
      return (
        <p
          className="text-body-small text-error flex items-center gap-1"
          data-testid={ONBOARDING_TEST_IDS.integrations.status(provider)}
          data-status="error"
          data-error={error ?? 'Connection failed'}
        >
          <ErrorIcon sx={{ fontSize: 14 }} />
          {error ?? 'Connection failed'}
        </p>
      );
    default:
      return (
        <p
          className="text-body-small text-on-surface-variant"
          data-testid={ONBOARDING_TEST_IDS.integrations.status(provider)}
          data-status="idle"
        >
          Not connected
        </p>
      );
  }
}

interface ActionButtonProps {
  status: IntegrationStatus;
  onConnect: () => void;
  onDisconnect: () => void;
  onRetry: () => void;
  provider: string;
}

function ActionButton({ status, onConnect, onDisconnect, onRetry, provider }: ActionButtonProps) {
  switch (status) {
    case 'connecting':
    case 'syncing':
      return (
        <Button
          variant="outlined"
          size="sm"
          disabled
          data-testid={ONBOARDING_TEST_IDS.integrations.action(provider)}
          data-status={status}
        >
          Connecting...
        </Button>
      );
    case 'success':
      return (
        <Button
          variant="text"
          size="sm"
          onClick={onDisconnect}
          data-testid={ONBOARDING_TEST_IDS.integrations.action(provider)}
          data-status="success"
        >
          Disconnect
        </Button>
      );
    case 'error':
      return (
        <Button
          variant="filled"
          size="sm"
          onClick={onRetry}
          data-testid={ONBOARDING_TEST_IDS.integrations.action(provider)}
          data-status="error"
        >
          Retry
        </Button>
      );
    default:
      return (
        <Button
          variant="filled"
          size="sm"
          onClick={onConnect}
          data-testid={ONBOARDING_TEST_IDS.integrations.action(provider)}
          data-status="idle"
        >
          Connect
        </Button>
      );
  }
}

interface AllIntegrationsDrawerProps {
  open: boolean;
  onClose: () => void;
  getIntegrationEntry: (provider: string) => IntegrationEntry | undefined;
  onConnect: (provider: string) => Promise<void>;
  onDisconnect: (provider: string) => void;
  onRetry: (provider: string) => void;
}

function AllIntegrationsDrawer({
  open,
  onClose,
  getIntegrationEntry,
  onConnect,
  onDisconnect,
  onRetry,
}: AllIntegrationsDrawerProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="bg-scrim/50 fixed inset-0 z-50"
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className={cn(
              'bg-surface-container fixed top-0 right-0 bottom-0 z-50',
              'w-full max-w-md overflow-y-auto shadow-lg',
            )}
          >
            {/* Header */}
            <div className="border-outline-variant flex items-center justify-between border-b p-4">
              <h3 className="text-title-large text-on-surface">All Integrations</h3>
              <button
                type="button"
                onClick={onClose}
                className="text-on-surface-variant hover:text-on-surface rounded-full p-1"
                aria-label="Close"
              >
                <CloseIcon />
              </button>
            </div>

            {/* Content */}
            <div className="space-y-3 p-4">
              <p className="text-body-small text-on-surface-variant mb-4">
                Connect your calendars and work tools to help Athena organize your day.
              </p>

              {ALL_PROVIDERS.map((provider) => {
                const entry = getIntegrationEntry(provider);
                const info = PROVIDER_INFO[provider] ?? {
                  name: provider,
                  icon: '🔗',
                  color: 'bg-gray-50',
                };

                return (
                  <IntegrationCard
                    key={provider}
                    provider={provider}
                    name={info.name}
                    icon={info.icon}
                    color={info.color}
                    status={entry?.status ?? 'idle'}
                    error={entry?.error ?? null}
                    syncedCount={entry?.syncedEventsCount}
                    onConnect={() => {
                      void onConnect(provider);
                    }}
                    onDisconnect={() => {
                      onDisconnect(provider);
                    }}
                    onRetry={() => {
                      onRetry(provider);
                    }}
                  />
                );
              })}

              {/* Coming soon note */}
              <p className="text-body-small text-on-surface-variant pt-4 text-center">
                More integrations coming soon, including Notion, Todoist, and Asana.
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
