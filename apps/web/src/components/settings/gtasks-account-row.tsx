import type { TeamOut } from '@docket/types';
import { TaskAlt } from '@docket/ui/icons';
import type { JSX } from 'react';

import { CardAlert, CardNote } from './card-note';
import { IntegrationConfigPanel } from './integration-config-panel';
import { IntegrationRowActions } from './integration-row-actions';
import type { GtasksRowModel } from './use-gtasks-controller';

/** Props for {@link GtasksAccountRow}. */
export interface GtasksAccountRowProps {
  /** The row's data, state, and bound actions from the controller. */
  row: GtasksRowModel;
  /** The active organization id (for the inline config panel). */
  orgId: string;
  /** Teams in the org (for the config panel's target-team selector). */
  teams: readonly TeamOut[];
  /** Whether the viewer may manage this connection. */
  canManage: boolean;
}

/**
 * One Google Tasks connection row: its identity, health, manage actions, and inline config panel.
 *
 * @remarks
 * Pure content — every value and callback comes from the {@link GtasksRowModel}. It reuses the
 * shared {@link IntegrationRowActions} cluster and {@link CardNote}/{@link CardAlert} footers so it
 * stays visually identical to the generic provider card.
 */
export function GtasksAccountRow({
  row,
  orgId,
  teams,
  canManage,
}: GtasksAccountRowProps): JSX.Element {
  const { account, state } = row;
  return (
    <li className="bg-surface-container-low overflow-hidden rounded-xl">
      <div className="flex flex-wrap items-center gap-3 p-4 sm:flex-nowrap">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="bg-surface-container text-on-surface-variant flex size-9 shrink-0 items-center justify-center rounded-lg">
            <TaskAlt aria-hidden="true" className="size-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-on-surface text-body-medium truncate font-medium">
              {row.label}
            </span>
            <span className="text-on-surface-variant truncate text-xs">{row.summary}</span>
          </div>
        </div>
        <IntegrationRowActions
          status={account.status}
          canManage={canManage}
          syncable
          isMigration={false}
          configurable
          configOpen={state.configOpen}
          busyReconnect={state.busyReconnect}
          busySync={state.busySync}
          busyDisconnect={state.busyDisconnect}
          // Serialize per row: any in-flight action blocks the others (Configure stays available).
          disabled={state.busyReconnect || state.busySync || state.busyDisconnect}
          onReconnect={row.actions.reconnect}
          onSync={row.actions.sync}
          onDisconnect={row.actions.requestDisconnect}
          onToggleConfig={row.actions.toggleConfig}
        />
      </div>

      {/* Persistent connection error from the server (survives reload). */}
      {account.status === 'error' ? (
        <CardAlert
          message="This account could not be synced."
          detail={
            <>
              Use <span className="font-medium">Reconnect</span>, or re-link this account under
              Connected accounts.
            </>
          }
        />
      ) : null}

      {state.error ? <CardNote tone="error">{state.error}</CardNote> : null}
      {state.feedback ? <CardNote tone="muted">{state.feedback}</CardNote> : null}

      {state.configOpen ? (
        <IntegrationConfigPanel orgId={orgId} integration={account} teams={teams} />
      ) : null}
    </li>
  );
}
