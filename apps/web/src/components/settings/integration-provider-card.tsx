'use client';

import type {
  IntegrationDirectoryProvider,
  IntegrationOut,
  IntegrationPattern,
} from '@docket/types';
import { Badge } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { ConnectWizard } from './connect-wizard';
import { relativeTime } from './format-time';
import { STATUS_LABEL, providerIcon } from './integrations-config';

interface IntegrationProviderCardProps {
  provider: IntegrationDirectoryProvider;
  existing: IntegrationOut | undefined;
  isOpen: boolean;
  canManage: boolean;
  /** A connect/verify ceremony is in flight for this provider. */
  busy: boolean;
  /** A manual sync is in flight for this integration. */
  syncing: boolean;
  /** A disconnect is in flight for this integration. */
  disconnecting: boolean;
  /** Transient success toast after a manual sync (e.g. "Synced 3 items."). */
  syncFeedback: string | null;
  /** Transient error from a connect/verify/disconnect action (persistent sync/connection errors
   * come from the server via `existing.lastError`). */
  actionError: string | null;
  onToggleOpen: () => void;
  /** Connect a brand-new integration with the chosen pattern (from the wizard). */
  onConnect: (pattern: IntegrationPattern) => void;
  /** Finish (pending) or repair (error) a connection — validates the credential, launching the
   * provider's OAuth consent when one is required. */
  onReconnect: () => void;
  onSync: () => void;
  onDisconnect: () => void;
}

/** IntegrationProviderCard renders one provider row whose state mirrors the server truthfully. */
export function IntegrationProviderCard({
  provider,
  existing,
  isOpen,
  canManage,
  busy,
  syncing,
  disconnecting,
  syncFeedback,
  actionError,
  onToggleOpen,
  onConnect,
  onReconnect,
  onSync,
  onDisconnect,
}: IntegrationProviderCardProps): JSX.Element {
  const ProviderIcon = providerIcon(provider.provider);
  const status = existing?.status;
  // Only a `connected` integration may surface healthy affordances (Sync) and a "last synced"
  // stamp — `pending`/`error` never read as working.
  const isConnected = status === 'connected';
  const needsConnect = status === 'pending' || status === 'error' || status === 'disconnected';

  /** Status-aware subtitle that never implies a connection that wasn't validated. */
  const subtitle = ((): string => {
    if (!existing) {
      return `Recommended: ${provider.pattern === 'migration' ? 'Migration' : 'Connector'}`;
    }
    const kind = existing.pattern === 'migration' ? 'migration' : 'connector';
    if (status === 'pending') return 'Setup not finished';
    if (status === 'error') return `Connection needs attention`;
    if (status === 'disconnected') return 'Disconnected';
    if (existing.lastSyncedAt)
      return `Connected as a ${kind} · Last synced ${relativeTime(existing.lastSyncedAt)}`;
    return `Connected as a ${kind}`;
  })();

  return (
    <li className="border-outline-variant bg-surface-container-low overflow-hidden rounded-xl border">
      <div className="flex items-center gap-3 p-4">
        <span className="bg-surface-container text-on-surface-variant flex size-9 shrink-0 items-center justify-center rounded-lg">
          <ProviderIcon aria-hidden="true" className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-on-surface text-body font-medium">{provider.name}</span>
          <span className="text-on-surface-variant text-xs">{subtitle}</span>
        </div>
        {existing ? (
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={STATUS_LABEL[existing.status].variant} className="font-normal">
              {STATUS_LABEL[existing.status].label}
            </Badge>
            {canManage ? (
              <>
                {needsConnect ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={onReconnect}
                    className="focus-visible:ring-ring text-primary hover:bg-surface-container-high text-body rounded-md px-3 py-1.5 font-medium transition-colors outline-none focus-visible:ring-1 disabled:opacity-50"
                  >
                    {busy
                      ? 'Connecting…'
                      : status === 'pending'
                        ? 'Finish connecting'
                        : 'Reconnect'}
                  </button>
                ) : null}
                {isConnected && existing.pattern !== 'migration' ? (
                  <button
                    type="button"
                    disabled={syncing}
                    onClick={onSync}
                    className="focus-visible:ring-ring text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high text-body rounded-md px-3 py-1.5 font-medium transition-colors outline-none focus-visible:ring-1 disabled:opacity-50"
                  >
                    {syncing ? 'Syncing…' : 'Sync'}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={disconnecting}
                  onClick={onDisconnect}
                  className="focus-visible:ring-ring text-destructive hover:bg-destructive/10 text-body rounded-md px-3 py-1.5 font-medium transition-colors outline-none focus-visible:ring-1 disabled:opacity-50"
                >
                  {disconnecting ? 'Disconnecting…' : 'Disconnect'}
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

      {/* Persistent connection/sync error — sourced from the server (survives reload), never
          ephemeral React state. */}
      {existing && status === 'error' && existing.lastError ? (
        <div role="alert" className="border-outline-variant border-t px-4 py-2 text-xs">
          <p className="text-destructive">{existing.lastError}</p>
          <p className="text-on-surface-variant mt-1">
            Use <span className="font-medium">Reconnect</span> to re-authorize and resume syncing.
          </p>
        </div>
      ) : null}

      {existing && status === 'pending' ? (
        <p className="text-on-surface-variant border-outline-variant border-t px-4 py-2 text-xs">
          Finish connecting to validate access and start syncing.
        </p>
      ) : null}

      {/* Transient action feedback (connect/verify/disconnect failures shown in the moment). */}
      {existing && actionError ? (
        <p
          role="alert"
          className="text-destructive border-outline-variant border-t px-4 py-2 text-xs"
        >
          {actionError}
        </p>
      ) : null}

      {existing && isConnected && syncFeedback ? (
        <p className="text-on-surface-variant border-outline-variant border-t px-4 py-2 text-xs">
          {syncFeedback}
        </p>
      ) : null}

      {isOpen && !existing ? (
        <ConnectWizard
          providerName={provider.name}
          recommendedPattern={provider.pattern}
          roles={provider.roles}
          connecting={busy}
          error={actionError}
          onConnect={onConnect}
          onCancel={onToggleOpen}
        />
      ) : null}
    </li>
  );
}
