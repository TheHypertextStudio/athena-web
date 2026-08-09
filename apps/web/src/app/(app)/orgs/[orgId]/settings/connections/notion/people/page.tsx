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

import { SectionHeader } from '@/components/settings/section-header';
import { NotionPeoplePanel } from '@/components/settings/notion/notion-people-panel';
import { useNotionMirror } from '@/components/settings/notion/use-notion-mirror-controller';
import { useAppParams } from '@/lib/app-location';

/** The Notion identity-matching page. */
export default function NotionPeoplePage(): JSX.Element {
  const { orgId } = useAppParams<{ orgId: string }>();
  const { integration, loading } = useNotionMirror(orgId);
  const backHref = `/orgs/${orgId}/settings/connections/notion`;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="People"
        description="How the people in your Notion workspace line up with the people in Docket."
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
          Connect Notion first, then come back to match people.
        </p>
      ) : (
        <NotionPeoplePanel orgId={orgId} integrationId={integration.id} />
      )}
    </div>
  );
}
