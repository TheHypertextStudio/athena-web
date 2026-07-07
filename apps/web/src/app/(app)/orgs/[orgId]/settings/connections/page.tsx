'use client';

/**
 * The Connections settings section.
 *
 * @remarks
 * Reached at `/orgs/[orgId]/settings/connections`. Connecting a tool here keeps it in **live sync**
 * (the tool stays the source of truth; Docket mirrors it) — the default. One-time/full imports
 * live in the sibling **Import** section. Includes the Google Tasks identity surface. The header
 * copy is resolved from the workspace's settings registry (personal vs org).
 *
 * Data is fetched at runtime, so the production build needs no running server.
 */
import { use, type JSX } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { IntegrationsTab } from '@/components/settings/integrations-tab';
import { McpConnectorsSection } from '@/components/settings/mcp-connectors-section';
import { SectionHeader } from '@/components/settings/section-header';
import { settingsSections } from '@/components/settings/sections';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';

/** The Connections section page. */
export default function ConnectionsSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): JSX.Element {
  const { orgId } = use(params);
  const { activeOrg } = useActiveOrg();
  const { canManage } = useCanManageOrg(orgId);

  const isPersonal = activeOrg?.isPersonal ?? false;
  const section = settingsSections(isPersonal).find((s) => s.key === 'connections');

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={section?.label ?? 'Connections'}
        description={section?.description ?? 'Connect tools to keep them in sync with Docket.'}
      />
      <IntegrationsTab orgId={orgId} canManage={canManage} surface="connections" />
      <McpConnectorsSection orgId={orgId} canManage={canManage} />
    </div>
  );
}
