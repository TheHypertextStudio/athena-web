'use client';

import type { JSX } from 'react';

import { ConnectionsPanel } from '@/components/settings/connections-panel';
import { ConnectedAccountsTab } from '@/components/settings/connected-accounts-tab';
import { SectionHeader } from '@/components/settings/section-header';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { usePersonalWorkspaceId } from '@/components/settings/use-personal-workspace-id';

/** The global outbound Connections destination for Athena data sources. */
export default function GlobalConnectionsSettingsPage(): JSX.Element {
  const orgId = usePersonalWorkspaceId();
  const { canManage } = useCanManageOrg(orgId ?? '');

  if (!orgId) {
    return <p className="text-on-surface-variant text-body-medium">Loading your connections…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Connections"
        description="Connect the apps Athena uses as data sources."
      />
      <ConnectedAccountsTab orgId={orgId} />
      <ConnectionsPanel orgId={orgId} canManage={canManage} />
    </div>
  );
}
