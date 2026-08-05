'use client';

import { useAppParams } from '@/lib/app-location';

import type { JSX } from 'react';

import { WorkspaceGeneralSettings } from '@/components/settings/workspace-general-settings';

/** Workspace-owned General settings route. */
export default function WorkspaceGeneralSettingsPage(): JSX.Element {
  const { orgId } = useAppParams<{ orgId: string }>();
  return <WorkspaceGeneralSettings orgId={orgId} />;
}
