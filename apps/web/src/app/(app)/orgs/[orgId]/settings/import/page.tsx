'use client';

/**
 * The Import settings section.
 *
 * @remarks
 * Reached at `/orgs/[orgId]/settings/import`. A **one-time, full import** (migration): Docket
 * becomes the source of truth and the imported tool can be retired — distinct from the sibling
 * **Connections** section, which keeps a tool in live sync. The header copy is resolved from the
 * workspace's settings registry (personal vs org).
 *
 * Data is fetched at runtime, so the production build needs no running server.
 */
import { use, type JSX } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { ImportPanel } from '@/components/settings/import-panel';
import { SectionHeader } from '@/components/settings/section-header';
import { settingsSections } from '@/components/settings/sections';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';

/** The Import section page. */
export default function ImportSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): JSX.Element {
  const { orgId } = use(params);
  const { activeOrg } = useActiveOrg();
  const { canManage } = useCanManageOrg(orgId);

  const isPersonal = activeOrg?.isPersonal ?? false;
  const section = settingsSections(isPersonal).find((s) => s.key === 'import');

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={section?.label ?? 'Import'}
        description={
          section?.description ?? 'Import everything from another tool into Docket, once.'
        }
      />
      <ImportPanel orgId={orgId} canManage={canManage} />
    </div>
  );
}
