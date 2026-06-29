'use client';

/**
 * The Authorized apps settings section.
 *
 * @remarks
 * Reached at `/orgs/[orgId]/settings/connected-apps` (personal workspace only — see
 * {@link PERSONAL_SETTINGS_SECTION_GROUPS}). This surface is the inverse of Connections /
 * Connected accounts:
 *
 * - **Connections** / **Connected accounts** — Docket connecting _out_ to other tools (GitHub,
 *   Linear, Google…) to pull your work in. Docket is the client.
 * - **Authorized apps** — external tools connecting _into_ Docket via MCP to read and act on
 *   your work. Docket is the server / data provider.
 *
 * The tab shows the MCP server URL for copy-paste into Claude Desktop, Cursor, or any other
 * MCP-compatible client, and lists the OAuth clients a user has already authorized, with a
 * revoke button per client.
 *
 * Data is fetched at runtime, so the production build needs no running server.
 */
import { use, type JSX } from 'react';

import { ConnectedAppsTab } from '@/components/settings/connected-apps-tab';
import { SectionHeader } from '@/components/settings/section-header';

/**
 * The Connected Apps section page.
 *
 * @param props - The dynamic route params (a Promise in the App Router).
 * @returns the rendered section.
 */
export default function ConnectedAppsSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): JSX.Element {
  const { orgId } = use(params);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Authorized apps"
        description="External apps (via MCP) you have authorized to read and act on your Docket account."
      />
      <ConnectedAppsTab orgId={orgId} />
    </div>
  );
}
