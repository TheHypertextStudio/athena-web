'use client';

import { use, type JSX } from 'react';

import { WorkspaceGeneralSettings } from '@/components/settings/workspace-general-settings';

/** Workspace-owned General settings route. */
export default function WorkspaceGeneralSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): JSX.Element {
  const { orgId } = use(params);
  return <WorkspaceGeneralSettings orgId={orgId} />;
}
