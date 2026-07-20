import type { IntegrationDirectoryProvider, IntegrationOut, TeamOut } from '@docket/types';
import type { JSX } from 'react';

import { IntegrationConfigPanel } from './integration-config-panel';
import { IntegrationProviderCard } from './integration-provider-card';
import { LinearAddAccountRow } from './linear-add-account-row';
import { SettingsSubsection } from './settings-subsection';
import type { LinearAddModel } from './linear-add-account-row';
import type { ProviderRowActions, ProviderRowState } from './use-integrations-data';

/** One provider row's fully-resolved props (built by a feature controller). */
export interface ProviderRowModel {
  key: string;
  provider: IntegrationDirectoryProvider;
  existing: IntegrationOut | undefined;
  /** The connect-action label for this feature (e.g. "Connect" or "Import"). */
  actionLabel: string;
  /** The not-yet-connected hint for this feature. */
  connectHint: string;
  /** What connecting unlocks, in user terms (Connections only). */
  effect?: string;
  /** Short data-flow phrase (Connections only). */
  mechanics?: string;
  configurable: boolean;
  state: ProviderRowState;
  actions: ProviderRowActions;
}

/** Props for {@link ProviderCategorySection}. */
export interface ProviderCategorySectionProps {
  /** The category's display label (its subsection heading). */
  label: string;
  rows: readonly ProviderRowModel[];
  orgId: string;
  teams: readonly TeamOut[];
  canManage: boolean;
  /** The Linear "add another account" affordance, when this category is Project management. */
  linearAdd?: LinearAddModel;
}

/** One provider card, wiring its inline config panel from the row model when configurable. */
function ProviderRow({
  row,
  orgId,
  teams,
  canManage,
}: {
  row: ProviderRowModel;
  orgId: string;
  teams: readonly TeamOut[];
  canManage: boolean;
}): JSX.Element {
  const configPanel =
    row.existing && row.configurable ? (
      <IntegrationConfigPanel
        orgId={orgId}
        integration={row.existing}
        teams={teams}
        onReauthorize={row.actions.reconnect}
      />
    ) : null;

  return (
    <IntegrationProviderCard
      provider={row.provider}
      existing={row.existing}
      canManage={canManage}
      actionLabel={row.actionLabel}
      connectHint={row.connectHint}
      effect={row.effect}
      mechanics={row.mechanics}
      busy={row.state.busy}
      syncing={row.state.syncing}
      disconnecting={row.state.disconnecting}
      syncFeedback={row.state.syncFeedback}
      actionError={row.state.actionError}
      configurable={row.configurable}
      configOpen={row.state.configOpen}
      configPanel={configPanel}
      onConnect={row.actions.connect}
      onReconnect={() => {
        void row.actions.reconnect();
      }}
      onSync={row.actions.sync}
      onDisconnect={row.actions.disconnect}
      onToggleConfig={row.actions.toggleConfig}
    />
  );
}

/**
 * A labelled category of provider cards. Shared content used by both Connections and Import — each
 * feature builds its own {@link ProviderRowModel}s (with its own copy), and this renders them.
 */
export function ProviderCategorySection({
  label,
  rows,
  orgId,
  teams,
  canManage,
  linearAdd,
}: ProviderCategorySectionProps): JSX.Element {
  return (
    <SettingsSubsection title={label}>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <ProviderRow key={row.key} row={row} orgId={orgId} teams={teams} canManage={canManage} />
        ))}
        {linearAdd ? <LinearAddAccountRow model={linearAdd} /> : null}
      </ul>
    </SettingsSubsection>
  );
}
