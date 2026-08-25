'use client';

import type { IntegrationDirectoryProvider, IntegrationOut } from '@docket/types';
import { Button, DecorativeIcon } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { CardNote } from './card-note';
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
  effect?: string | undefined;
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
  manageHref?: string | null | undefined;
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

/** The one line beneath a provider name, selected from the connection's current state. */
function connectionSummary(
  existing: IntegrationOut | undefined,
  unconnectedSummary: string,
  actionError: string | null,
): string | null {
  if (!existing) return unconnectedSummary;
  if (actionError) return actionError;
  if (existing.status === 'pending') return 'Finish connecting this account.';
  if (existing.status === 'error') return 'This connection needs attention.';
  if (existing.status === 'disconnected') return 'This account is disconnected.';
  return connectionLabel(existing);
}

/** Right-side affordance for a provider with no integration yet (connect directly — no inline choice). */
function ConnectAffordance(props: {
  canManage: boolean;
  actionLabel: string;
  busy: boolean;
  onConnect: () => void;
}): JSX.Element {
  if (!props.canManage) {
    return (
      <span className="text-on-surface-variant text-body-small">Ask an admin to configure</span>
    );
  }
  return (
    <Button controlSize="md" variant="ghost" disabled={props.busy} onClick={props.onConnect}>
      {props.busy ? 'Connecting…' : props.actionLabel}
    </Button>
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
  const ProviderIcon = providerIcon(provider.provider);
  const showSyncFeedback = existing?.status === 'connected' && Boolean(syncFeedback);
  const summary = connectionSummary(existing, effect ?? connectHint, actionError);

  return (
    <li className="bg-surface-container-low overflow-hidden rounded-xl">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-4">
        <DecorativeIcon icon={ProviderIcon} className="bg-surface-container shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-on-surface text-label-large">{provider.name}</span>
          {summary ? (
            <span
              {...(actionError ? { role: 'alert' } : {})}
              className={`${actionError ? 'text-error' : 'text-on-surface-variant'} text-body-small truncate`}
            >
              {summary}
            </span>
          ) : null}
        </div>
        {existing ? (
          <IntegrationRowActions
            provider={provider.provider}
            providerName={provider.name}
            status={existing.status}
            canManage={canManage}
            syncable={provider.syncable}
            isMigration={existing.pattern === 'migration'}
            configurable={configurable}
            configOpen={configOpen}
            manageHref={manageHref ?? null}
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

      {showSyncFeedback && syncFeedback ? <CardNote tone="muted">{syncFeedback}</CardNote> : null}

      {configOpen ? configPanel : null}
    </li>
  );
}
