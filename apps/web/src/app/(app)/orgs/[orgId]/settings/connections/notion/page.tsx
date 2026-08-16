'use client';

/**
 * The Docket-in-Notion hub.
 *
 * @remarks
 * Reached at `/orgs/[orgId]/settings/connections/notion`, following the same shape as the
 * `connections/google-calendar` page: a section header plus one feature component. Notion gets a
 * page of its own rather than an inline disclosure on the Connections card because nine designed
 * databases, identity matching and sync history do not fit — and burying them three levels deep
 * inside a card is what made the existing connector configuration hard to find.
 */
import type { JSX } from 'react';

import { NotionMirrorPanel } from '@/components/settings/notion/notion-mirror-panel';
import { useConnectionsParent } from '@/components/settings/use-connections-parent';
import { useAppParams } from '@/lib/app-location';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';

/** The Notion mirror hub page. */
export default function NotionMirrorPage(): JSX.Element {
  const { orgId } = useAppParams<{ orgId: string }>();
  const { canManage } = useCanManageOrg(orgId);
  const parent = useConnectionsParent(orgId);

  return (
    <SettingsSectionPage
      title="Notion"
      description="Build databases in your Notion workspace from your Docket work, and keep them current."
      parent={parent}
    >
      <NotionMirrorPanel orgId={orgId} canManage={canManage} />
    </SettingsSectionPage>
  );
}
