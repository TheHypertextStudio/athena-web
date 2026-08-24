'use client';

import { useTypedRoute } from '@/lib/app-location';

import type { JSX } from 'react';

import { WorkspaceGeneralSettings } from '@/components/settings/workspace-general-settings';

/** Workspace-owned General settings route. */
export default function WorkspaceGeneralSettingsPage(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/settings/general');
  return <WorkspaceGeneralSettings orgId={orgId} />;
}
