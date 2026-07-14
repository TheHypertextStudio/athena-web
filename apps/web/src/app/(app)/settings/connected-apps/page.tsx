'use client';

import type { JSX } from 'react';

import { ConnectedAppsTab } from '@/components/settings/connected-apps-tab';
import { SectionHeader } from '@/components/settings/section-header';
import { usePersonalWorkspaceId } from '@/components/settings/use-personal-workspace-id';

/** The global inbound Connected apps destination. */
export default function GlobalConnectedAppsSettingsPage(): JSX.Element {
  const orgId = usePersonalWorkspaceId();

  if (!orgId) {
    return <p className="text-on-surface-variant text-body">Loading connected apps…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Connected apps"
        description="Manage external apps that can access Docket."
      />
      <ConnectedAppsTab orgId={orgId} />
    </div>
  );
}
