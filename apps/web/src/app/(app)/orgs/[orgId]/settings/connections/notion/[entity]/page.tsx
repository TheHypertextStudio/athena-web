'use client';

/**
 * One entity's Notion table designer.
 *
 * @remarks
 * Reached at `/orgs/[orgId]/settings/connections/notion/[entity]`. A page per entity rather than a
 * tabbed panel: each design is an independent decision, the preview read is expensive enough that
 * nine of them should not load together, and a per-entity URL is linkable from the hub's
 * attention block.
 *
 * An unknown `entity` segment renders a plain not-found rather than throwing, so a stale
 * bookmark from before an entity was renamed is a dead end the user can read, not a crash.
 */
import { NotionMirrorEntity } from '@docket/connections/notion/mirror-contract';
import type { JSX } from 'react';

import { entityLabel } from '@/components/settings/notion/notion-copy';
import { NotionTableDesigner } from '@/components/settings/notion/notion-table-designer';
import { useAppParams } from '@/lib/app-location';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { useNotionMirror } from '@/components/settings/notion/use-notion-mirror-controller';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';

/** The per-entity table designer page. */
export default function NotionTableDesignerPage(): JSX.Element {
  const { orgId, entity } = useAppParams<{ orgId: string; entity: string }>();
  const { integration, loading } = useNotionMirror(orgId);
  const { canManage, loading: permissionLoading } = useCanManageOrg(orgId);

  const parsed = NotionMirrorEntity.safeParse(entity);
  const backHref = `/orgs/${orgId}/settings/connections/notion`;

  const parent = { label: 'Notion', href: backHref } as const;

  if (!parsed.success) {
    return (
      <SettingsSectionPage
        title="Not found"
        description="There is no Notion table by that name."
        parent={parent}
      >
        <p className="text-on-surface-variant text-body-medium">
          The address may be from before this table was renamed. Every table Docket can build for
          you is listed on the Notion page.
        </p>
      </SettingsSectionPage>
    );
  }

  return (
    <SettingsSectionPage
      title={entityLabel(parsed.data)}
      description="Shape the Notion database Docket will build for this, then review it against your own rows."
      parent={parent}
      loading={loading || permissionLoading}
    >
      {integration === null ? (
        <p className="text-on-surface-variant text-body-medium">
          Connect Notion first, then come back to shape this table.
        </p>
      ) : (
        <NotionTableDesigner
          orgId={orgId}
          integrationId={integration.id}
          entity={parsed.data}
          canManage={canManage}
        />
      )}
    </SettingsSectionPage>
  );
}
