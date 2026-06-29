'use client';

import type { IntegrationDirectoryProvider, IntegrationOut } from '@docket/types';
import { Badge } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { relativeTime } from './format-time';
import { IntegrationActionButton } from './integration-action-button';
import { STATUS_LABEL, providerIcon } from './integrations-config';

interface IntegrationProviderCardProps {
  provider: IntegrationDirectoryProvider;
  existing: IntegrationOut | undefined;
  canManage: boolean;
  /** Whether this connector can actually be set up here (OAuth configured or local mock). */
  available: boolean;
  /** The connect-action label for this surface (e.g. "Connect" or "Import"). */
  actionLabel: string;
  /** A one-line hint shown under a not-yet-connected provider (what connecting does). */
  connectHint: string;
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
  /** Connect this provider on the current surface (pattern is fixed by the surface). */
  onConnect: () => void;
  /** Finish (pending) or repair (error) a connection — validates the credential, launching the
   * provider's OAuth consent when one is required. */
  onReconnect: () => void;
  onSync: () => void;
  onDisconnect: () => void;
}

/**
 * The status-aware subtitle. Never implies a connection that wasn't validated: an unconfigured
 * provider reads "not yet available", an unconnected one reads the surface hint, and only a
 * `connected` integration reads "Connected".
 */
function cardSubtitle(
  existing: IntegrationOut | undefined,
  available: boolean,
  connectHint: string,
): string {
  if (!existing) {
    if (!available) return 'Not yet available in this workspace';
    return connectHint;
  }
  if (existing.status === 'pending') return 'Setup not finished';
  if (existing.status === 'error') return 'Connection needs attention';
  if (existing.status === 'disconnected') return 'Disconnected';
  if (existing.lastSyncedAt)
    return `Connected · Last synced ${relativeTime(existing.lastSyncedAt)}`;
  return 'Connected';
}

/** The re-authorize button label for a not-yet-healthy integration. */
function reconnectLabel(status: IntegrationOut['status'], busy: boolean): string {
  if (busy) return 'Connecting…';
  return status === 'pending' ? 'Finish connecting' : 'Reconnect';
}

/** Right-side controls for an already-created integration (badge + manage actions). */
function ExistingControls(props: {
  existing: IntegrationOut;
  canManage: boolean;
  busy: boolean;
  syncing: boolean;
  disconnecting: boolean;
  onReconnect: () => void;
  onSync: () => void;
  onDisconnect: () => void;
}): JSX.Element {
  const { existing, canManage, busy, syncing, disconnecting } = props;
  const isConnected = existing.status === 'connected';
  const needsConnect =
    existing.status === 'pending' ||
    existing.status === 'error' ||
    existing.status === 'disconnected';
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Badge variant={STATUS_LABEL[existing.status].variant} className="font-normal">
        {STATUS_LABEL[existing.status].label}
      </Badge>
      {canManage && needsConnect ? (
        <IntegrationActionButton tone="primary" disabled={busy} onClick={props.onReconnect}>
          {reconnectLabel(existing.status, busy)}
        </IntegrationActionButton>
      ) : null}
      {canManage && isConnected && existing.pattern !== 'migration' ? (
        <IntegrationActionButton tone="muted" disabled={syncing} onClick={props.onSync}>
          {syncing ? 'Syncing…' : 'Sync'}
        </IntegrationActionButton>
      ) : null}
      {canManage ? (
        <IntegrationActionButton
          tone="danger"
          disabled={disconnecting}
          onClick={props.onDisconnect}
        >
          {disconnecting ? 'Disconnecting…' : 'Disconnect'}
        </IntegrationActionButton>
      ) : null}
    </div>
  );
}

/** Right-side affordance for a provider with no integration yet (connect directly — no inline choice). */
function ConnectAffordance(props: {
  available: boolean;
  canManage: boolean;
  actionLabel: string;
  busy: boolean;
  onConnect: () => void;
}): JSX.Element {
  // Not connectable here (no OAuth configured, not local mock): never offer to set it up.
  if (!props.available) {
    return (
      <span className="text-on-surface-variant border-outline-variant rounded-md border px-3 py-1.5 text-xs font-medium">
        Available soon
      </span>
    );
  }
  if (!props.canManage) {
    return <span className="text-on-surface-variant text-xs">Ask an admin to configure</span>;
  }
  return (
    <IntegrationActionButton tone="primary" disabled={props.busy} onClick={props.onConnect}>
      {props.busy ? 'Connecting…' : props.actionLabel}
    </IntegrationActionButton>
  );
}

/** A bordered footer row beneath the card header (an error or info notice). */
function CardNote(props: { tone: 'error' | 'muted'; children: string }): JSX.Element {
  const color = props.tone === 'error' ? 'text-destructive' : 'text-on-surface-variant';
  return (
    <p
      {...(props.tone === 'error' ? { role: 'alert' } : {})}
      className={`${color} border-outline-variant border-t px-4 py-2 text-xs`}
    >
      {props.children}
    </p>
  );
}

/** IntegrationProviderCard renders one provider row whose state mirrors the server truthfully. */
export function IntegrationProviderCard({
  provider,
  existing,
  canManage,
  available,
  actionLabel,
  connectHint,
  busy,
  syncing,
  disconnecting,
  syncFeedback,
  actionError,
  onConnect,
  onReconnect,
  onSync,
  onDisconnect,
}: IntegrationProviderCardProps): JSX.Element {
  const ProviderIcon = providerIcon(provider.provider);
  const reauthError = existing?.status === 'error' ? existing.lastError : null;
  const showPendingHint = existing?.status === 'pending';
  const showSyncFeedback = existing?.status === 'connected' && Boolean(syncFeedback);

  return (
    <li className="border-outline-variant bg-surface-container-low overflow-hidden rounded-xl border">
      <div className="flex items-center gap-3 p-4">
        <span className="bg-surface-container text-on-surface-variant flex size-9 shrink-0 items-center justify-center rounded-lg">
          <ProviderIcon aria-hidden="true" className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-on-surface text-body font-medium">{provider.name}</span>
          <span className="text-on-surface-variant text-xs">
            {cardSubtitle(existing, available, connectHint)}
          </span>
        </div>
        {existing ? (
          <ExistingControls
            existing={existing}
            canManage={canManage}
            busy={busy}
            syncing={syncing}
            disconnecting={disconnecting}
            onReconnect={onReconnect}
            onSync={onSync}
            onDisconnect={onDisconnect}
          />
        ) : (
          <ConnectAffordance
            available={available}
            canManage={canManage}
            actionLabel={actionLabel}
            busy={busy}
            onConnect={onConnect}
          />
        )}
      </div>

      {/* Persistent connection error from the server (survives reload), never ephemeral state. */}
      {reauthError ? (
        <div role="alert" className="border-outline-variant border-t px-4 py-2 text-xs">
          <p className="text-destructive">{reauthError}</p>
          <p className="text-on-surface-variant mt-1">
            Use <span className="font-medium">Reconnect</span> to re-authorize and resume syncing.
          </p>
        </div>
      ) : null}

      {showPendingHint ? (
        <CardNote tone="muted">Finish connecting to validate access and start syncing.</CardNote>
      ) : null}

      {existing && actionError ? <CardNote tone="error">{actionError}</CardNote> : null}

      {showSyncFeedback && syncFeedback ? <CardNote tone="muted">{syncFeedback}</CardNote> : null}
    </li>
  );
}
