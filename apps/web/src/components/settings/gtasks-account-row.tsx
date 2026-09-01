import type { TeamOut } from '../../lib/contracts/team';
import { TaskAlt } from '@docket/ui/icons';
import { DecorativeIcon } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { CardNote } from './card-note';
import { IntegrationConfigPanel } from './integration-config-panel';
import { IntegrationRowActions } from './integration-row-actions';
import { connectionCardCopy } from './integrations-config';
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
  const description = connectionCardCopy('gtasks').effect;
  return (
    <li className="bg-surface-container-low overflow-hidden rounded-xl">
      <div className="grid grid-cols-1 items-start gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <DecorativeIcon icon={TaskAlt} className="bg-surface-container shrink-0" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-on-surface text-label-large truncate">{row.label}</span>
            <span className="text-on-surface-variant text-body-small">{description}</span>
          </div>
        </div>
        {canManage ? (
          <div className="justify-self-end sm:col-start-2 sm:row-start-1">
            <IntegrationRowActions
              provider="gtasks"
              providerName={row.label}
              status={account.status}
              canManage={canManage}
              syncable
              isMigration={false}
              configurable
              configOpen={state.configOpen}
              manageHref={null}
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
        ) : null}
      </div>

      {state.feedback ? <CardNote tone="muted">{state.feedback}</CardNote> : null}
      {state.error ? <CardNote tone="error">{state.error}</CardNote> : null}

      {state.configOpen ? (
        <IntegrationConfigPanel orgId={orgId} integration={account} teams={teams} />
      ) : null}
    </li>
  );
}
