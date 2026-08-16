'use client';

import { useAppParams } from '@/lib/app-location';

/**
 * The Automations settings section.
 *
 * @remarks
 * Reached at `/orgs/[orgId]/settings/automations`. Lists the org's automation rules
 * (`on → when → then`) with enable/disable + delete. Defaults are seeded as editable rows.
 * Data is fetched at runtime, so the production build needs no running server.
 */
import type { JSX } from 'react';

import { useActiveOrg } from '@/components/active-org';
import AutomationsTab from '@/components/settings/automations-tab';
import { MailIngestSection } from '@/components/settings/mail-ingest-section';
import { workspaceSettingsSections } from '@/components/settings/settings-registry';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';

/** The Automations section page. */
export default function AutomationsSettingsPage(): JSX.Element {
  const { orgId } = useAppParams<{ orgId: string }>();
  const { activeOrg } = useActiveOrg();
  const { canManage } = useCanManageOrg(orgId);

  const isPersonal = activeOrg?.isPersonal ?? false;
  const section = workspaceSettingsSections(isPersonal).find((s) => s.key === 'automations');

  return (
    <SettingsSectionPage
      title={section?.label ?? 'Automations'}
      description={section?.description ?? 'Rules that act on your email suggestions and tasks.'}
    >
      <MailIngestSection orgId={orgId} canManage={canManage} />
      <AutomationsTab orgId={orgId} canManage={canManage} />
    </SettingsSectionPage>
  );
}
