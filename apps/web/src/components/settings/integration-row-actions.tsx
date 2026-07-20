import type { IntegrationOut } from '@docket/types';
import { Badge } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { IntegrationActionButton } from './integration-action-button';
import { STATUS_LABEL } from './integrations-config';

/** The re-authorize button label for a not-yet-healthy integration. */
function reconnectLabel(status: IntegrationOut['status'], busy: boolean): string {
  if (busy) return 'Connecting…';
  return status === 'pending' ? 'Finish connecting' : 'Reconnect';
}

/** Props for {@link IntegrationRowActions}. */
export interface IntegrationRowActionsProps {
  /** The connection's server status (drives the badge and which actions apply). */
  status: IntegrationOut['status'];
  /** Whether the viewer may manage this connection at all. */
  canManage: boolean;
  /** Whether this provider supports manual sync (observe-only signal sources don't). */
  syncable: boolean;
  /** One-time migrations have no ongoing sync. */
  isMigration: boolean;
  /** Whether this row exposes an inline config panel (adds the Configure toggle). */
  configurable: boolean;
  /** Whether that config panel is currently expanded. */
  configOpen: boolean;
  /** A reconnect/verify ceremony is in flight. */
  busyReconnect: boolean;
  /** A manual sync is in flight. */
  busySync: boolean;
  /** A disconnect is in flight. */
  busyDisconnect: boolean;
  /**
   * Disable every action regardless of the per-action flags — for callers that serialize actions
   * per row (any in-flight action blocks the others). The per-action `busy*` flags still choose
   * which button shows its progress label. Omit to gate each button only on its own flag.
   */
  disabled?: boolean;
  onReconnect: () => void;
  onSync: () => void;
  onDisconnect: () => void;
  onToggleConfig: () => void;
}

/**
 * The right-side manage controls for an existing integration: a status badge plus the
 * reconnect / sync / configure / disconnect actions that apply to its current state.
 *
 * @remarks
 * Shared by the generic provider card and the Google Tasks rows — the two previously duplicated
 * this cluster with subtly different markup. Which buttons appear is a pure function of
 * `status` + the capability flags, so both callers get one consistent control set.
 */
export function IntegrationRowActions({
  status,
  canManage,
  syncable,
  isMigration,
  configurable,
  configOpen,
  busyReconnect,
  busySync,
  busyDisconnect,
  disabled = false,
  onReconnect,
  onSync,
  onDisconnect,
  onToggleConfig,
}: IntegrationRowActionsProps): JSX.Element {
  const isConnected = status === 'connected';
  const needsConnect = status === 'pending' || status === 'error' || status === 'disconnected';
  return (
    <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2 sm:w-auto">
      <Badge variant={STATUS_LABEL[status].variant} className="font-normal">
        {STATUS_LABEL[status].label}
      </Badge>
      {canManage && needsConnect ? (
        <IntegrationActionButton
          tone="primary"
          disabled={disabled || busyReconnect}
          onClick={onReconnect}
        >
          {reconnectLabel(status, busyReconnect)}
        </IntegrationActionButton>
      ) : null}
      {canManage && isConnected && !isMigration && syncable ? (
        <IntegrationActionButton tone="muted" disabled={disabled || busySync} onClick={onSync}>
          {busySync ? 'Syncing…' : 'Sync'}
        </IntegrationActionButton>
      ) : null}
      {canManage && configurable ? (
        <IntegrationActionButton tone="primary" aria-expanded={configOpen} onClick={onToggleConfig}>
          {configOpen ? 'Close' : 'Configure'}
        </IntegrationActionButton>
      ) : null}
      {canManage ? (
        <IntegrationActionButton
          tone="danger"
          disabled={disabled || busyDisconnect}
          onClick={onDisconnect}
        >
          {busyDisconnect ? 'Disconnecting…' : 'Disconnect'}
        </IntegrationActionButton>
      ) : null}
    </div>
  );
}
