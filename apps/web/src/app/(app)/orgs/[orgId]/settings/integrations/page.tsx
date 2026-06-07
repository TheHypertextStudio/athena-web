'use client';

/**
 * The Integrations settings section (mvp-plan §8.7).
 *
 * @remarks
 * Reached at `/orgs/[orgId]/settings/integrations`. Wraps the existing {@link IntegrationsTab}
 * (the categorized provider directory whose connect flow forces the Migration-vs-Connector
 * decision up front). The tab's write affordances are gated on whether the caller can manage
 * the org, which this page resolves via {@link useCanManageOrg} — previously this was threaded
 * down from the single Settings screen; now each routed section derives it independently.
 *
 * The header copy is gated on whether the active workspace is the caller's **personal** space:
 * it is resolved from {@link settingsSections} for that workspace (rather than the static org
 * registry), so a personal workspace shows its own framing ("Integrations & import") with no
 * "organization"/"your team" wording, matching the section nav. It falls back to the org
 * registry while the active org is still loading.
 *
 * Data is fetched at runtime, so the production build needs no running server.
 */
import { use, type JSX } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { IntegrationsTab } from '@/components/settings/integrations-tab';
import { SectionHeader } from '@/components/settings/section-header';
import { settingsSections } from '@/components/settings/sections';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';

/**
 * The Integrations section page.
 *
 * @param props - The dynamic route params (a Promise in the App Router).
 * @returns the rendered section.
 */
export default function IntegrationsSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): JSX.Element {
  const { orgId } = use(params);
  const { activeOrg } = useActiveOrg();
  const { canManage } = useCanManageOrg(orgId);

  // Resolve the header copy from the registry for this workspace (personal vs shared org), so a
  // personal workspace shows its own framing rather than the org-framed copy.
  const section = settingsSections(activeOrg?.isPersonal ?? false).find(
    (s) => s.key === 'integrations',
  );

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={section?.label ?? 'Integrations'}
        description={section?.description ?? 'Connect the tools your team already uses.'}
      />
      <IntegrationsTab orgId={orgId} canManage={canManage} />
    </div>
  );
}
