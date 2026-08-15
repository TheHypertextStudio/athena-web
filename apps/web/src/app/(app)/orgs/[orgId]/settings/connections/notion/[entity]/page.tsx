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
import NextLink from 'next/link';
import type { JSX } from 'react';

import { SectionHeader } from '@/components/settings/section-header';
import { entityLabel } from '@/components/settings/notion/notion-copy';
import { NotionTableDesigner } from '@/components/settings/notion/notion-table-designer';
import { useAppParams } from '@/lib/app-location';
import { useNotionMirror } from '@/components/settings/notion/use-notion-mirror-controller';

/** The per-entity table designer page. */
export default function NotionTableDesignerPage(): JSX.Element {
  const { orgId, entity } = useAppParams<{ orgId: string; entity: string }>();
  const { integration, loading } = useNotionMirror(orgId);

  const parsed = NotionMirrorEntity.safeParse(entity);
  const backHref = `/orgs/${orgId}/settings/connections/notion`;

  if (!parsed.success) {
    return (
      <div className="flex flex-col gap-4">
        <SectionHeader title="Not found" description="There is no Notion table by that name." />
        <NextLink href={backHref} className="text-primary text-label-large">
          Back to Notion
        </NextLink>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={entityLabel(parsed.data)}
        description="Shape the Notion database Docket will build for this, then review it against your own rows."
        action={
          <NextLink
            href={backHref}
            className="text-on-surface-variant text-body-medium hover:underline"
          >
            Back to Notion
          </NextLink>
        }
      />
      {loading ? (
        <p className="text-on-surface-variant text-body-medium">Loading your Notion setup…</p>
      ) : integration === null ? (
        <p className="text-on-surface-variant text-body-medium">
          Connect Notion first, then come back to shape this table.
        </p>
      ) : (
        <NotionTableDesigner orgId={orgId} integrationId={integration.id} entity={parsed.data} />
      )}
    </div>
  );
}
