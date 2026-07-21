'use client';

/**
 * `settings` — the **Connections** panel: connect a tool to keep it in live sync.
 *
 * @remarks
 * The composition for the Connections feature. It calls {@link useConnectionsController} (which
 * wraps the shared {@link useIntegrationsData}) and arranges the intro, the "This workspace" scope
 * zone, the Google Tasks and Calendar sections, then each provider category. Pure presentation — no
 * fetching or mutation of its own. Kept entirely separate from {@link ImportPanel}: live sync and
 * one-time migration are different products, not one component behind a flag.
 */
import type { JSX } from 'react';

import { CalendarConnectionRow } from './calendar-connection-row';
import { IntegrationsIntro } from './integrations-intro';
import { DisconnectConfirmDialog } from './disconnect-confirm-dialog';
import { GtasksAccountsSection } from './gtasks-accounts-section';
import { IntegrationsStatus } from './integrations-status';
import { LinearAgentInstallCard } from './linear-agent-install-card';
import { ProviderCategorySection } from './provider-category-section';
import { SettingsSubsection } from './settings-subsection';
import { useConnectionsController } from './use-connections-controller';
import { WorkspaceScopeHeader } from './workspace-scope-header';

/** Props for {@link ConnectionsPanel}. */
export interface ConnectionsPanelProps {
  orgId: string;
  canManage: boolean;
  /** Route to the personal "Connected accounts" surface; omit when it renders inline above. */
  linkedAccountsHref?: string;
}

/** The Connections settings panel (live sync). */
export function ConnectionsPanel({
  orgId,
  canManage,
  linkedAccountsHref,
}: ConnectionsPanelProps): JSX.Element {
  const c = useConnectionsController({ orgId, canManage, linkedAccountsHref });

  return (
    <IntegrationsStatus loading={c.loading} loadError={c.loadError}>
      <div className="flex flex-col gap-6">
        <IntegrationsIntro
          text={c.intro.text}
          crossHref={c.intro.crossHref}
          crossText={c.intro.crossText}
        />

        <WorkspaceScopeHeader linkedAccountsHref={c.scope.linkedAccountsHref} />

        {/* Distinct from the generic multi-provider directory below: an org-wide, admin-only app
            grant, not a "connect your account" affordance — see LinearAgentInstallCard's remarks. */}
        <LinearAgentInstallCard orgId={c.orgId} canManage={c.canManage} />

        {c.gtasks ? (
          <GtasksAccountsSection
            orgId={c.orgId}
            canManage={c.canManage}
            directory={c.gtasks.directory}
            accounts={c.gtasks.accounts}
            teams={c.gtasks.teams}
            loading={c.gtasks.loading}
          />
        ) : null}

        {c.calendar ? (
          <SettingsSubsection title="Calendar">
            <CalendarConnectionRow
              name={c.calendar.name}
              effect={c.calendar.effect}
              href={c.calendar.href}
            />
          </SettingsSubsection>
        ) : null}

        {c.categories.map((section) => (
          <ProviderCategorySection
            key={section.category}
            label={section.label}
            rows={section.rows}
            orgId={c.orgId}
            teams={c.teams}
            canManage={c.canManage}
            linearAdd={section.linearAdd ?? undefined}
          />
        ))}

        <DisconnectConfirmDialog
          providerName={c.confirm.target?.providerName ?? null}
          onConfirm={c.confirm.confirm}
          onCancel={c.confirm.cancel}
        />
      </div>
    </IntegrationsStatus>
  );
}
