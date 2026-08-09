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

import { SectionHeader } from '@/components/settings/section-header';
import { NotionMirrorPanel } from '@/components/settings/notion/notion-mirror-panel';
import { useAppParams } from '@/lib/app-location';

/** The Notion mirror hub page. */
export default function NotionMirrorPage(): JSX.Element {
  const { orgId } = useAppParams<{ orgId: string }>();

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Notion"
        description="Build databases in your Notion workspace from your Docket work, and keep them current."
      />
      <NotionMirrorPanel orgId={orgId} />
    </div>
  );
}
