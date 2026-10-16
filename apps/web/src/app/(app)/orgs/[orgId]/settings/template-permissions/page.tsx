'use client';
import type { JSX } from 'react';
import { useTypedRoute } from '@/lib/app-location';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';
import { WorkTemplateAuthoringSetting } from '@/components/templates/work-template-settings';

/** Manage template authoring authority separately from the work-definition workspace. */
export default function TemplatePermissionsPage(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/settings/template-permissions');
  return (
    <SettingsSectionPage sectionKey="template-permissions">
      <WorkTemplateAuthoringSetting orgId={orgId} />
    </SettingsSectionPage>
  );
}
