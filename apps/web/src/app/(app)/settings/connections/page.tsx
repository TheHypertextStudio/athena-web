'use client';

import type { JSX } from 'react';

import { ConnectionsPanel } from '@/components/settings/connections-panel';
import { ConnectedAccountsTab } from '@/components/settings/connected-accounts-tab';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { usePersonalWorkspaceId } from '@/components/settings/use-personal-workspace-id';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';

/** The global outbound Connections destination for Athena data sources. */
export default function GlobalConnectionsSettingsPage(): JSX.Element {
  const orgId = usePersonalWorkspaceId();
  const { canManage } = useCanManageOrg(orgId ?? '');

  if (!orgId) {
    return <p className="text-on-surface-variant text-body-medium">Loading your connections…</p>;
  }

  return (
    <SettingsSectionPage
      title="Connections"
      description="Connect the apps Athena uses as data sources."
    >
      <ConnectedAccountsTab orgId={orgId} />
      {/* This route is the caller's own personal space by construction — it resolves the personal
          workspace id itself — so the shared-workspace scope explainer never applies here. */}
      <ConnectionsPanel orgId={orgId} canManage={canManage} isPersonal />
    </SettingsSectionPage>
  );
}
