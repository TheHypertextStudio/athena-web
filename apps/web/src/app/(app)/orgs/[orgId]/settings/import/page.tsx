'use client';

import { useTypedRoute } from '@/lib/app-location';

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
import type { JSX } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { ImportPanel } from '@/components/settings/import-panel';
import { workspaceSettingsSections } from '@/components/settings/settings-registry';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';

/** The Import section page. */
export default function ImportSettingsPage(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/settings/import');
  const { activeOrg } = useActiveOrg();
  const { canManage } = useCanManageOrg(orgId);

  const isPersonal = activeOrg?.isPersonal ?? false;
  const section = workspaceSettingsSections(isPersonal).find((s) => s.key === 'import');

  return (
    <SettingsSectionPage
      title={section?.label ?? 'Import'}
      description={section?.description ?? 'Import everything from another tool into Docket, once.'}
    >
      <ImportPanel orgId={orgId} canManage={canManage} />
    </SettingsSectionPage>
  );
}
