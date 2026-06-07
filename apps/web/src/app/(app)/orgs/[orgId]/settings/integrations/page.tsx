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
 * Data is fetched at runtime, so the production build needs no running server.
 */
import { use, type JSX } from 'react';

import { IntegrationsTab } from '@/components/settings/integrations-tab';
import { SectionHeader } from '@/components/settings/section-header';
import { SETTINGS_SECTIONS } from '@/components/settings/sections';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';

/** The registry entry for this section (its title + description copy). */
const SECTION = SETTINGS_SECTIONS.find((s) => s.key === 'integrations');

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
  const { canManage } = useCanManageOrg(orgId);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={SECTION?.label ?? 'Integrations'}
        description={SECTION?.description ?? 'Connect the tools your team already uses.'}
      />
      <IntegrationsTab orgId={orgId} canManage={canManage} />
    </div>
  );
}
