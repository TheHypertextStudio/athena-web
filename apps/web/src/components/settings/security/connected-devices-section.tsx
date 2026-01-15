'use client';

import { useEffect, useState } from 'react';
import DevicesOutlinedIcon from '@mui/icons-material/DevicesOutlined';
import { appPasswordsApi, type AppPassword } from '@/lib/api-client';
import {
  SettingsSection,
  SettingsItemCard,
  SettingsEmptyState,
  SectionError,
} from '@/components/settings/settings-section';
import { ConnectedDeviceActions, AddDeviceButton } from './connected-devices-actions';
import type { ApiErrorCode } from '@/lib/api-errors';

/**
 * Format the last used timestamp for display.
 */
function formatLastUsed(lastUsedAt: string | null, lastUsedIp: string | null): string {
  if (!lastUsedAt) {
    return 'Never used';
  }

  const date = new Date(lastUsedAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let timeAgo: string;
  if (diffMins < 1) {
    timeAgo = 'Just now';
  } else if (diffMins < 60) {
    timeAgo = `${String(diffMins)} min ago`;
  } else if (diffHours < 24) {
    timeAgo = `${String(diffHours)} hour${diffHours > 1 ? 's' : ''} ago`;
  } else if (diffDays < 7) {
    timeAgo = `${String(diffDays)} day${diffDays > 1 ? 's' : ''} ago`;
  } else {
    timeAgo = date.toLocaleDateString();
  }

  // Anonymize IP for display
  const ipDisplay = lastUsedIp ? ` from ${lastUsedIp.split('.').slice(0, 3).join('.')}.x` : '';

  return `Last used: ${timeAgo}${ipDisplay}`;
}

/**
 * Format scopes for display.
 */
function formatScopes(scopes: string[]): string {
  const scopeLabels: Record<string, string> = {
    caldav: 'Calendars',
    carddav: 'Contacts',
  };
  return scopes.map((s) => scopeLabels[s] ?? s).join(', ');
}

/**
 * Loading skeleton for the section.
 */
function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2].map((i) => (
        <div key={i} className="bg-surface-container-high animate-pulse rounded-lg p-4">
          <div className="flex items-center gap-4">
            <div className="bg-surface-container-highest h-10 w-10 rounded" />
            <div className="flex-1 space-y-2">
              <div className="bg-surface-container-highest h-4 w-32 rounded" />
              <div className="bg-surface-container-highest h-3 w-48 rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ConnectedDevicesSection() {
  const [devices, setDevices] = useState<AppPassword[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorCode, setErrorCode] = useState<ApiErrorCode | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchDevices() {
      try {
        const result = await appPasswordsApi.list();
        if (!cancelled) {
          setDevices(result.data);
          setErrorCode(null);
        }
      } catch (e) {
        if (!cancelled) {
          // Map error to code
          if (e instanceof Error && 'status' in e) {
            const status = (e as { status: number }).status;
            if (status === 401) setErrorCode('unauthorized');
            else if (status === 403) setErrorCode('forbidden');
            else if (status === 429) setErrorCode('rate_limited');
            else setErrorCode('unknown');
          } else {
            setErrorCode('unknown');
          }
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void fetchDevices();

    return () => {
      cancelled = true;
    };
  }, []);

  if (errorCode) {
    return (
      <SettingsSection
        title="Connected Devices"
        description="Devices using app passwords to sync calendars and contacts."
      >
        <SectionError code={errorCode} />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title="Connected Devices"
      description="Devices using app passwords to sync calendars and contacts via CalDAV/CardDAV."
    >
      {isLoading ? (
        <LoadingSkeleton />
      ) : (
        <div className="space-y-3">
          {devices.length > 0 ? (
            devices.map((device) => (
              <SettingsItemCard
                key={device.id}
                icon={<DevicesOutlinedIcon sx={{ fontSize: 20 }} />}
                title={device.name}
                description={`${formatLastUsed(device.lastUsedAt, device.lastUsedIp)} • ${formatScopes(device.scopes)}`}
                action={<ConnectedDeviceActions device={device} />}
              />
            ))
          ) : (
            <SettingsEmptyState message="No devices connected yet. Add a device to sync with native calendar apps." />
          )}

          <AddDeviceButton />
        </div>
      )}
    </SettingsSection>
  );
}
