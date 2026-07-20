'use client';

/**
 * The Automations settings section.
 *
 * @remarks
 * Reached at `/orgs/[orgId]/settings/automations`. Lists the org's automation rules
 * (`on → when → then`) with enable/disable + delete. Defaults are seeded as editable rows.
 * Data is fetched at runtime, so the production build needs no running server.
 */
import { use, type JSX } from 'react';

import { useActiveOrg } from '@/components/active-org';
import AutomationsTab from '@/components/settings/automations-tab';
import { MailIngestSection } from '@/components/settings/mail-ingest-section';
import { SectionHeader } from '@/components/settings/section-header';
import { settingsSections } from '@/components/settings/sections';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';

/** The Automations section page. */
export default function AutomationsSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): JSX.Element {
  const { orgId } = use(params);
  const { activeOrg } = useActiveOrg();
  const { canManage } = useCanManageOrg(orgId);

  const isPersonal = activeOrg?.isPersonal ?? false;
  const section = settingsSections(isPersonal).find((s) => s.key === 'automations');

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={section?.label ?? 'Automations'}
        description={section?.description ?? 'Rules that act on your email suggestions and tasks.'}
      />
      <MailIngestSection orgId={orgId} canManage={canManage} />
      <AutomationsTab orgId={orgId} canManage={canManage} />
    </div>
  );
}
