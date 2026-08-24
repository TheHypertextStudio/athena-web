'use client';

import { useTypedRoute } from '@/lib/app-location';

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

import { ConnectionsPanel } from '@/components/settings/connections-panel';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { useSharedOnlyGuard } from '@/components/settings/use-shared-only-guard';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';

/** The Connections section page. */
export default function ConnectionsSettingsPage(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/settings/connections');
  const { canManage } = useCanManageOrg(orgId);

  if (useSharedOnlyGuard('connections', orgId)) return <></>;

  return (
    <SettingsSectionPage sectionKey="connections">
      <ConnectionsPanel
        orgId={orgId}
        canManage={canManage}
        // Linked identities are user-scoped, not workspace-scoped, and now live in the Personal
        // group of the settings modal rather than under this org's own settings tree.
        linkedAccountsHref="/settings/connected-accounts"
      />
    </SettingsSectionPage>
  );
}
