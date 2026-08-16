'use client';

import { useSharedOnlyGuard } from '@/components/settings/use-shared-only-guard';
import { useAppParams } from '@/lib/app-location';
import type { JSX } from 'react';
import { MembersTab } from '@/components/settings/members-tab';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';

/**
 * The Members & Access section page.
 *
 * @param props - The dynamic route params (a Promise in the App Router).
 * @returns the rendered section.
 */
export default function MembersSettingsPage(): JSX.Element {
  const { orgId } = useAppParams<{ orgId: string }>();

  // One redirect, driven by the section's own `sharedOnly` declaration rather than a condition
  // retyped per route — which is how Publishing came to render on a workspace with nothing to
  // publish. It stays at the route because routing does.
  if (useSharedOnlyGuard('members')) return <></>;

  return (
    <SettingsSectionPage sectionKey="members">
      <MembersTab orgId={orgId} />
    </SettingsSectionPage>
  );
}
