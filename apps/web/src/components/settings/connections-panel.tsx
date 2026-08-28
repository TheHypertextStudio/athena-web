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
import { ProductRequiredNotice } from './product-required-notice';
import { useConnectionsController } from './use-connections-controller';
import { WorkspaceScopeHeader } from './workspace-scope-header';

/** Props for {@link ConnectionsPanel}. */
export interface ConnectionsPanelProps {
  orgId: string;
  canManage: boolean;
  /** Route to the personal "Connected accounts" surface; omit when it renders inline above. */
  linkedAccountsHref?: string;
  /**
   * Whether the workspace is the caller's personal space.
   *
   * @remarks
   * Suppresses the workspace-scope explainer. That copy tells the reader these connections are
   * shared — "anyone with access can use them, and workspace admins manage them" — which is a
   * sentence about other people, addressed to someone who is the only person here. Org-backing is
   * an implementation detail of a personal workspace and must not surface as org framing.
   */
  isPersonal?: boolean;
}

/** The Connections settings panel (live sync). */
export function ConnectionsPanel({
  orgId,
  canManage,
  linkedAccountsHref,
  isPersonal = false,
}: ConnectionsPanelProps): JSX.Element {
  const c = useConnectionsController({ orgId, canManage, linkedAccountsHref, isPersonal });

  if (c.productRequired) {
    return (
      <ProductRequiredNotice
        orgId={c.orgId}
        title="Connect external tools with Docket Pro"
        body="Docket Pro adds live connections for calendars, tasks, documents, and code. The rest of your workspace remains available on your current plan."
      />
    );
  }

  return (
    <IntegrationsStatus loading={c.loading} loadError={c.loadError}>
      <div className="flex flex-col gap-6">
        <IntegrationsIntro crossHref={c.intro.crossHref} crossText={c.intro.crossText} />

        {isPersonal ? null : (
          <WorkspaceScopeHeader linkedAccountsHref={c.scope.linkedAccountsHref} />
        )}

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
          <CalendarConnectionRow
            name={c.calendar.name}
            effect={c.calendar.effect}
            href={c.calendar.href}
          />
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
