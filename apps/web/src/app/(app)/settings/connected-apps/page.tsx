'use client';

import type { JSX } from 'react';

import { ConnectedAppsTab } from '@/components/settings/connected-apps-tab';
import { usePersonalWorkspaceId } from '@/components/settings/use-personal-workspace-id';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';

/** The global inbound Connected apps destination. */
export default function GlobalConnectedAppsSettingsPage(): JSX.Element {
  const orgId = usePersonalWorkspaceId();

  if (!orgId) {
    return <p className="text-on-surface-variant text-body-medium">Loading connected apps…</p>;
  }

  return (
    <SettingsSectionPage
      title="Connected apps"
      description="Manage external apps that can access Docket."
    >
      <ConnectedAppsTab orgId={orgId} />
    </SettingsSectionPage>
  );
}
