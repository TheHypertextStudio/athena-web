'use client';

import { useAppParams } from '@/lib/app-location';

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
import type { JSX } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { ConnectionsPanel } from '@/components/settings/connections-panel';
import { SectionHeader } from '@/components/settings/section-header';
import { workspaceSettingsSections } from '@/components/settings/settings-registry';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';

/** The Connections section page. */
export default function ConnectionsSettingsPage(): JSX.Element {
  const { orgId } = useAppParams<{ orgId: string }>();
  const { activeOrg } = useActiveOrg();
  const { canManage } = useCanManageOrg(orgId);

  const isPersonal = activeOrg?.isPersonal ?? false;
  const section = workspaceSettingsSections(isPersonal).find((s) => s.key === 'connections');

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={section?.label ?? 'Connections'}
        description={section?.description ?? 'Connect tools to keep them in sync with Docket.'}
      />
      <ConnectionsPanel
        orgId={orgId}
        canManage={canManage}
        // Linked identities are user-scoped, not workspace-scoped, and now live in the Personal
        // group of the settings modal rather than under this org's own settings tree.
        linkedAccountsHref="/settings/connected-accounts"
      />
    </div>
  );
}
