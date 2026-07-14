'use client';

import type { JSX } from 'react';

import { IntegrationsTab } from '@/components/settings/integrations-tab';
import { ConnectedAccountsTab } from '@/components/settings/connected-accounts-tab';
import { McpConnectorsSection } from '@/components/settings/mcp-connectors-section';
import { SectionHeader } from '@/components/settings/section-header';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { usePersonalWorkspaceId } from '@/components/settings/use-personal-workspace-id';

/** The global outbound Connections destination for Athena data sources. */
export default function GlobalConnectionsSettingsPage(): JSX.Element {
  const orgId = usePersonalWorkspaceId();
  const { canManage } = useCanManageOrg(orgId ?? '');

  if (!orgId) {
    return <p className="text-on-surface-variant text-body">Loading your connections…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Connections"
        description="Connect the apps Athena uses as data sources."
      />
      <ConnectedAccountsTab orgId={orgId} />
      <IntegrationsTab orgId={orgId} canManage={canManage} surface="connections" />
      <McpConnectorsSection orgId={orgId} canManage={canManage} />
    </div>
  );
}
