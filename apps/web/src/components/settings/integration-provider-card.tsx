'use client';

import type { IntegrationDirectoryProvider, IntegrationOut } from '@docket/types';
import type { JSX } from 'react';

import { CardAlert, CardNote } from './card-note';
import { relativeTime } from './format-time';
import { IntegrationActionButton } from './integration-action-button';
import { IntegrationRowActions } from './integration-row-actions';
import { providerIcon } from './integrations-config';

interface IntegrationProviderCardProps {
  provider: IntegrationDirectoryProvider;
  existing: IntegrationOut | undefined;
  canManage: boolean;
  /** The connect-action label for this surface (e.g. "Connect" or "Import"). */
  actionLabel: string;
  /** A one-line hint shown under a not-yet-connected provider (what connecting does). */
  connectHint: string;
  /**
   * What connecting this unlocks, in user terms (Connections surface only). Rendered as a
   * persistent descriptor under the provider name. Omitted on surfaces (e.g. Import) that keep
   * their own terser {@link connectHint} wording.
   */
  effect?: string;
  /**
   * Short data-flow direction phrase (Connections surface only), shown as the secondary line while
   * the provider is not yet connected. Once connected, the status/last-synced line replaces it.
   */
  mechanics?: string;
  /** A connect/verify ceremony is in flight for this provider. */
  busy: boolean;
  /** A manual sync is in flight for this integration. */
  syncing: boolean;
  /** A disconnect is in flight for this integration. */
  disconnecting: boolean;
  /** Transient success toast after a manual sync (e.g. "Synced 3 items."). */
  syncFeedback: string | null;
  /** Application-owned error copy from a connect/verify/disconnect action. */
  actionError: string | null;
  /** Whether this provider has an inline config panel (adds the "Configure" toggle). */
  configurable: boolean;
  /** Whether the config panel is currently expanded. */
  configOpen: boolean;
  /** The config panel content, rendered inline when `configOpen` (built by the caller). */
  configPanel: JSX.Element | null;
  /** Connect this provider on the current surface (pattern is fixed by the surface). */
  onConnect: () => void;
  /** Finish (pending) or repair (error) a connection — validates the credential, launching the
   * provider's OAuth consent when one is required. */
  onReconnect: () => void;
  onSync: () => void;
  onDisconnect: () => void;
  /** Toggle the inline config panel open/closed. */
  onToggleConfig: () => void;
}

/**
 * The status-aware subtitle for a provider that has an integration. Never implies a connection
 * that wasn't validated: only a `connected` integration reads "Connected".
 */
function statusSubtitle(existing: IntegrationOut): string {
  if (existing.status === 'pending') return 'Setup not finished';
  if (existing.status === 'error') return 'Connection needs attention';
  if (existing.status === 'disconnected') return 'Disconnected';
  if (existing.lastSyncedAt)
    return `Connected · Last synced ${relativeTime(existing.lastSyncedAt)}`;
  return 'Connected';
}

/** Human-readable account/workspace identity for one concrete provider connection. */
function connectionLabel(existing: IntegrationOut | undefined): string | null {
  if (!existing) return null;
  const values = [existing.connection.account, existing.connection.externalWorkspaceName].filter(
    (value): value is string => Boolean(value),
  );
  return [...new Set(values)].join(' · ') || null;
}

/** Right-side affordance for a provider with no integration yet (connect directly — no inline choice). */
function ConnectAffordance(props: {
  canManage: boolean;
  actionLabel: string;
  busy: boolean;
  onConnect: () => void;
}): JSX.Element {
  if (!props.canManage) {
    return <span className="text-on-surface-variant text-xs">Ask an admin to configure</span>;
  }
  return (
    <IntegrationActionButton tone="primary" disabled={props.busy} onClick={props.onConnect}>
      {props.busy ? 'Connecting…' : props.actionLabel}
    </IntegrationActionButton>
  );
}

/** IntegrationProviderCard renders one provider row whose state mirrors the server truthfully. */
export function IntegrationProviderCard({
  provider,
  existing,
  canManage,
  actionLabel,
  connectHint,
  effect,
  mechanics,
  busy,
  syncing,
  disconnecting,
  syncFeedback,
  actionError,
  configurable,
  configOpen,
  configPanel,
  onConnect,
  onReconnect,
  onSync,
  onDisconnect,
  onToggleConfig,
}: IntegrationProviderCardProps): JSX.Element {
  const ProviderIcon = providerIcon(provider.provider);
  const showPendingHint = existing?.status === 'pending';
  const showSyncFeedback = existing?.status === 'connected' && Boolean(syncFeedback);
  const identityLabel = connectionLabel(existing);

  return (
    <li className="bg-surface-container-low overflow-hidden rounded-xl">
      <div className="flex flex-wrap items-center gap-3 p-4 sm:flex-nowrap">
        <span className="bg-surface-container text-on-surface-variant flex size-9 shrink-0 items-center justify-center rounded-lg">
          <ProviderIcon aria-hidden="true" className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-on-surface text-body-medium font-medium">{provider.name}</span>
          {effect ? <span className="text-on-surface-variant text-xs">{effect}</span> : null}
          {identityLabel ? (
            <span className="text-on-surface-variant truncate text-xs">{identityLabel}</span>
          ) : null}
          <span className="text-on-surface-variant text-xs">
            {existing ? statusSubtitle(existing) : (mechanics ?? connectHint)}
          </span>
        </div>
        {existing ? (
          <IntegrationRowActions
            status={existing.status}
            canManage={canManage}
            syncable={provider.syncable}
            isMigration={existing.pattern === 'migration'}
            configurable={configurable}
            configOpen={configOpen}
            busyReconnect={busy}
            busySync={syncing}
            busyDisconnect={disconnecting}
            onReconnect={onReconnect}
            onSync={onSync}
            onDisconnect={onDisconnect}
            onToggleConfig={onToggleConfig}
          />
        ) : (
          <ConnectAffordance
            canManage={canManage}
            actionLabel={actionLabel}
            busy={busy}
            onConnect={onConnect}
          />
        )}
      </div>

      {/* Persistent connection error from the server (survives reload), never ephemeral state. */}
      {existing?.status === 'error' ? (
        <CardAlert
          message="This connection needs attention. Reconnect it to restore syncing."
          detail={
            <>
              Use <span className="font-medium">Reconnect</span> to re-authorize and resume syncing.
            </>
          }
        />
      ) : null}

      {showPendingHint ? (
        <CardNote tone="muted">Finish connecting to validate access and start syncing.</CardNote>
      ) : null}

      {existing && actionError ? <CardNote tone="error">{actionError}</CardNote> : null}

      {showSyncFeedback && syncFeedback ? <CardNote tone="muted">{syncFeedback}</CardNote> : null}

      {configOpen ? configPanel : null}
    </li>
  );
}
