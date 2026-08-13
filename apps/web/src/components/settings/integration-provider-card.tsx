'use client';

import type { IntegrationDirectoryProvider, IntegrationOut } from '@docket/types';
import { DecorativeIcon } from '@docket/ui/primitives';
import NextLink from 'next/link';
import type { JSX } from 'react';

import { CardAlert, CardNote } from './card-note';
import { IntegrationActionButton } from './integration-action-button';
import { CONNECTION_ERROR_MESSAGE, integrationStatusLabel } from './integration-status';
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
  /**
   * Route to this provider's own settings page, when it has one instead of an inline panel.
   *
   * @remarks
   * Notion's case: nine designed databases, a table designer, identity matching and sync history
   * do not fit in a card disclosure. Without this link that page is reachable only by typing the
   * URL, so it is the provider's entry point rather than a convenience.
   */
  manageHref?: string | null;
  /** Connect this provider on the current surface (pattern is fixed by the surface). */
  onConnect: () => void;
  /** Repair a failed connection, or change a provider-owned installation. */
  onReconnect: () => void;
  onSync: () => void;
  onDisconnect: () => void;
  /** Toggle the inline config panel open/closed. */
  onToggleConfig: () => void;
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
  manageHref,
  onConnect,
  onReconnect,
  onSync,
  onDisconnect,
  onToggleConfig,
}: IntegrationProviderCardProps): JSX.Element {
  // Pending records exist only while the browser is away at a provider. Do not turn a canceled or
  // interrupted redirect into a half-connected card: Connect starts the full ceremony again.
  const visibleIntegration = existing?.status === 'pending' ? undefined : existing;
  const ProviderIcon = providerIcon(provider.provider);
  const showSyncFeedback = visibleIntegration?.status === 'connected' && Boolean(syncFeedback);
  const identityLabel = connectionLabel(visibleIntegration);

  return (
    <li className="bg-surface-container-low overflow-hidden rounded-xl">
      <div className="flex flex-wrap items-center gap-3 p-4 sm:flex-nowrap">
        <DecorativeIcon icon={ProviderIcon} className="bg-surface-container shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-on-surface text-body-medium font-medium">{provider.name}</span>
          {effect ? <span className="text-on-surface-variant text-xs">{effect}</span> : null}
          {identityLabel ? (
            <span className="text-on-surface-variant truncate text-xs">{identityLabel}</span>
          ) : null}
          <span className="text-on-surface-variant text-xs">
            {visibleIntegration
              ? integrationStatusLabel(visibleIntegration)
              : (mechanics ?? connectHint)}
          </span>
        </div>
        {visibleIntegration && manageHref ? (
          <NextLink
            href={manageHref}
            className="text-primary text-label-large shrink-0 hover:underline"
          >
            {visibleIntegration.status === 'connected' ? 'Manage' : 'Set up'}
          </NextLink>
        ) : null}
        {visibleIntegration ? (
          <IntegrationRowActions
            provider={provider.provider}
            status={visibleIntegration.status}
            canManage={canManage}
            syncable={provider.syncable}
            isMigration={visibleIntegration.pattern === 'migration'}
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
      {visibleIntegration?.status === 'error' ? (
        <CardAlert
          message={CONNECTION_ERROR_MESSAGE}
          detail={
            <>
              Use <span className="font-medium">Reconnect</span> to re-authorize and resume syncing.
            </>
          }
        />
      ) : null}

      {visibleIntegration && actionError ? <CardNote tone="error">{actionError}</CardNote> : null}

      {showSyncFeedback && syncFeedback ? <CardNote tone="muted">{syncFeedback}</CardNote> : null}

      {configOpen ? configPanel : null}
    </li>
  );
}
