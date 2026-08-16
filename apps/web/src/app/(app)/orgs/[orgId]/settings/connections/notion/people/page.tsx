'use client';

/**
 * Who is who across Notion and Docket.
 *
 * @remarks
 * A static segment, so it wins over the sibling `[entity]` route — `people` is not an entity kind
 * (`person` is), and without this the hub's "Match people" link landed on the table designer's
 * not-found state.
 */
import NextLink from 'next/link';
import type { JSX } from 'react';

import { NotionPeoplePanel } from '@/components/settings/notion/notion-people-panel';
import { useNotionMirror } from '@/components/settings/notion/use-notion-mirror-controller';
import { useAppParams } from '@/lib/app-location';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';

/** The Notion identity-matching page. */
export default function NotionPeoplePage(): JSX.Element {
  const { orgId } = useAppParams<{ orgId: string }>();
  const { integration, loading } = useNotionMirror(orgId);
  // Folded into the same pending branch below: resolving the permission after the panel has
  // painted would flash write controls the caller may not hold.
  const { canManage, loading: permissionLoading } = useCanManageOrg(orgId);
  const backHref = `/orgs/${orgId}/settings/connections/notion`;

  return (
    <SettingsSectionPage
      title="People"
      description="How the people in your Notion workspace line up with the people in Docket."
      action={
        <NextLink
          href={backHref}
          className="text-on-surface-variant text-body-medium hover:underline"
        >
          {' '}
          Back to Notion{' '}
        </NextLink>
      }
    >
      {loading || permissionLoading ? (
        <p className="text-on-surface-variant text-body-medium">Loading your Notion setup…</p>
      ) : integration === null ? (
        <p className="text-on-surface-variant text-body-medium">
          Connect Notion first, then come back to match people.
        </p>
      ) : (
        <NotionPeoplePanel orgId={orgId} integrationId={integration.id} canManage={canManage} />
      )}
    </SettingsSectionPage>
  );
}
