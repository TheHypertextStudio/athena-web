'use client';

import type {
  IntegrationDirectoryProvider,
  IntegrationOut,
  IntegrationPattern,
} from '@docket/types';
import { Badge } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { ConnectWizard } from './connect-wizard';
import { STATUS_LABEL, providerIcon } from './integrations-config';

interface IntegrationProviderCardProps {
  provider: IntegrationDirectoryProvider;
  existing: IntegrationOut | undefined;
  isOpen: boolean;
  canManage: boolean;
  syncingId: string | null;
  disconnectingId: string | null;
  syncFeedback: Record<string, string | null>;
  syncErrors: Record<string, string | null>;
  disconnectErrors: Record<string, string | null>;
  connecting: boolean;
  connectError: string | null;
  onToggleOpen: () => void;
  onSync: () => void;
  onDisconnect: () => void;
  onConnect: (pattern: IntegrationPattern) => void;
}

export function IntegrationProviderCard({
  provider,
  existing,
  isOpen,
  canManage,
  syncingId,
  disconnectingId,
  syncFeedback,
  syncErrors,
  disconnectErrors,
  connecting,
  connectError,
  onToggleOpen,
  onSync,
  onDisconnect,
  onConnect,
}: IntegrationProviderCardProps): JSX.Element {
  const ProviderIcon = providerIcon(provider.provider);

  return (
    <li className="border-outline-variant bg-surface-container-low overflow-hidden rounded-xl border">
      <div className="flex items-center gap-3 p-4">
        <span className="bg-surface-container text-on-surface-variant flex size-9 shrink-0 items-center justify-center rounded-lg">
          <ProviderIcon aria-hidden="true" className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-on-surface text-body font-medium">{provider.name}</span>
          <span className="text-on-surface-variant text-xs">
            {existing
              ? `Connected as ${existing.pattern === 'migration' ? 'a migration' : 'a connector'}`
              : `Recommended: ${provider.pattern === 'migration' ? 'Migration' : 'Connector'}`}
          </span>
        </div>
        {existing ? (
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={STATUS_LABEL[existing.status].variant} className="font-normal">
              {STATUS_LABEL[existing.status].label}
            </Badge>
            {canManage ? (
              <>
                {existing.pattern !== 'migration' ? (
                  <button
                    type="button"
                    disabled={syncingId === existing.id}
                    onClick={onSync}
                    className="focus-visible:ring-ring text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high text-body rounded-md px-3 py-1.5 font-medium transition-colors outline-none focus-visible:ring-1 disabled:opacity-50"
                  >
                    {syncingId === existing.id ? 'Syncing…' : 'Sync'}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={disconnectingId === existing.id}
                  onClick={onDisconnect}
                  className="focus-visible:ring-ring text-destructive hover:bg-destructive/10 text-body rounded-md px-3 py-1.5 font-medium transition-colors outline-none focus-visible:ring-1 disabled:opacity-50"
                >
                  {disconnectingId === existing.id ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </>
            ) : null}
          </div>
        ) : canManage ? (
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={onToggleOpen}
            className="focus-visible:ring-ring text-primary hover:bg-surface-container-high text-body rounded-md px-3 py-1.5 font-medium transition-colors outline-none focus-visible:ring-1"
          >
            {isOpen ? 'Close' : 'Configure'}
          </button>
        ) : (
          <span className="text-on-surface-variant text-xs">Ask an admin to configure</span>
        )}
      </div>

      {existing?.status === 'error' ? (
        <p className="text-on-surface-variant border-outline-variant border-t px-4 py-2 text-xs">
          Connection needs attention — try syncing to retry. If the issue persists, re-authenticate
          from your account settings.
        </p>
      ) : null}

      {existing && syncFeedback[existing.id] ? (
        <p className="text-on-surface-variant border-outline-variant border-t px-4 py-2 text-xs">
          {syncFeedback[existing.id]}
        </p>
      ) : null}

      {existing && syncErrors[existing.id] ? (
        <div role="alert" className="border-outline-variant border-t px-4 py-2 text-xs">
          <p className="text-destructive">{syncErrors[existing.id]}</p>
          {/sign in with (\w+)/i.test(syncErrors[existing.id] ?? '') ? (
            <p className="text-on-surface-variant mt-1">
              To fix this, sign in again with{' '}
              {(/sign in with (\w+)/i.exec(syncErrors[existing.id] ?? '') ?? [])[1]} from your
              account settings, then retry.
            </p>
          ) : null}
        </div>
      ) : null}

      {existing && disconnectErrors[existing.id] ? (
        <p
          role="alert"
          className="text-destructive border-outline-variant border-t px-4 py-2 text-xs"
        >
          {disconnectErrors[existing.id]}
        </p>
      ) : null}

      {isOpen && !existing ? (
        <ConnectWizard
          providerName={provider.name}
          recommendedPattern={provider.pattern}
          roles={provider.roles}
          connecting={connecting}
          error={connectError}
          onConnect={onConnect}
          onCancel={onToggleOpen}
        />
      ) : null}
    </li>
  );
}
