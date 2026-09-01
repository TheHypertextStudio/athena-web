'use client';

import type { IntegrationOut } from '@docket/connections/integration-contract';
import { Ellipsis } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import type { JSX } from 'react';

import NextLink from '@/components/docket-link';

/** The repair/install button label for a not-yet-healthy integration. */
function reconnectLabel(provider: string, status: IntegrationOut['status'], busy: boolean): string {
  if (status === 'pending') return busy ? 'Finishing…' : 'Finish setup';
  if (busy) return provider === 'github' ? 'Opening GitHub…' : 'Connecting…';
  return provider === 'github' ? 'Retry GitHub installation' : 'Reconnect';
}

/** Props for {@link IntegrationRowActions}. */
export interface IntegrationRowActionsProps {
  /** Provider id, used where a provider owns a distinct authorization ceremony. */
  provider: string;
  /** Provider name, used to give the overflow trigger a precise accessible name. */
  providerName: string;
  /** The connection's server status, which decides whether repair replaces management. */
  status: IntegrationOut['status'];
  /** Whether the viewer may manage this connection at all. */
  canManage: boolean;
  /** Whether this provider supports manual sync. */
  syncable: boolean;
  /** One-time migrations have no ongoing sync. */
  isMigration: boolean;
  /** Whether this row exposes an inline config panel. */
  configurable: boolean;
  /** Whether that config panel is currently expanded. */
  configOpen: boolean;
  /** Route to the provider's dedicated management page, when it has one. */
  manageHref: string | null;
  /** A reconnect/verify ceremony is in flight. */
  busyReconnect: boolean;
  /** A manual sync is in flight. */
  busySync: boolean;
  /** A disconnect is in flight. */
  busyDisconnect: boolean;
  /** Disable every action regardless of the per-action flags. */
  disabled?: boolean;
  onReconnect: () => void;
  onSync: () => void;
  onDisconnect: () => void;
  onToggleConfig: () => void;
}

/** Render one contextual action and a menu for secondary commands. */
export function IntegrationRowActions({
  provider,
  providerName,
  status,
  canManage,
  syncable,
  isMigration,
  configurable,
  configOpen,
  manageHref,
  busyReconnect,
  busySync,
  busyDisconnect,
  disabled = false,
  onReconnect,
  onSync,
  onDisconnect,
  onToggleConfig,
}: IntegrationRowActionsProps): JSX.Element | null {
  if (!canManage) return null;

  const isConnected = status === 'connected';
  const needsConnect = status === 'pending' || status === 'error' || status === 'disconnected';
  const canSync = isConnected && !isMigration && syncable;

  return (
    <div className="flex shrink-0 flex-nowrap items-center justify-end gap-1">
      {needsConnect ? (
        <Button
          controlSize="md"
          variant="ghost"
          disabled={disabled || busyReconnect}
          onClick={onReconnect}
        >
          {reconnectLabel(provider, status, busyReconnect)}
        </Button>
      ) : manageHref ? (
        <Button controlSize="md" variant="ghost" asChild>
          <NextLink href={manageHref}>Manage</NextLink>
        </Button>
      ) : configurable ? (
        <Button
          controlSize="md"
          variant="ghost"
          aria-expanded={configOpen}
          onClick={onToggleConfig}
        >
          {configOpen ? 'Close' : 'Manage'}
        </Button>
      ) : provider === 'github' ? (
        <Button
          controlSize="md"
          variant="ghost"
          disabled={disabled || busyReconnect}
          onClick={onReconnect}
        >
          {busyReconnect ? 'Opening GitHub…' : 'Manage'}
        </Button>
      ) : null}

      {busySync || busyDisconnect ? (
        <span role="status" className="text-on-surface-variant text-body-small shrink-0">
          {busySync ? 'Syncing…' : 'Disconnecting…'}
        </span>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            controlSize="md"
            variant="ghost"
            iconOnly
            aria-label={`Actions for ${providerName}`}
            disabled={disabled || busyDisconnect}
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canSync ? (
            <DropdownMenuItem disabled={disabled || busySync} onSelect={onSync}>
              {busySync ? 'Syncing…' : 'Sync now'}
            </DropdownMenuItem>
          ) : null}
          {canSync ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem
            destructive
            disabled={disabled || busyDisconnect}
            onSelect={onDisconnect}
          >
            {busyDisconnect ? 'Disconnecting…' : 'Disconnect'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
