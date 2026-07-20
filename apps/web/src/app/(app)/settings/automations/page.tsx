'use client';

/**
 * The global (personal-workspace) Automations settings page.
 *
 * @remarks
 * Mirror of the org-scoped `/orgs/[orgId]/settings/automations` page, resolved against the signed-in
 * user's personal workspace. It hosts the email-to-task workflow (which turns a connected inbox's
 * mail into task suggestions) above the automation rules it seeds — deliberately separate from
 * **Connections**, where the inbox itself is linked: configuring a service and building a workflow
 * on top of it are different concerns.
 *
 * Data is fetched at runtime, so the production build needs no running server.
 */
import type { JSX } from 'react';

import AutomationsTab from '@/components/settings/automations-tab';
import { MailIngestSection } from '@/components/settings/mail-ingest-section';
import { SectionHeader } from '@/components/settings/section-header';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { usePersonalWorkspaceId } from '@/components/settings/use-personal-workspace-id';

/** The global Automations destination for the user's personal workspace. */
export default function GlobalAutomationsSettingsPage(): JSX.Element {
  const orgId = usePersonalWorkspaceId();
  const { canManage } = useCanManageOrg(orgId ?? '');

  if (!orgId) {
    return <p className="text-on-surface-variant text-body-medium">Loading your automations…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Automations"
        description="Rules that turn your email and tasks into action."
      />
      <MailIngestSection orgId={orgId} canManage={canManage} />
      <AutomationsTab orgId={orgId} canManage={canManage} />
    </div>
  );
}
