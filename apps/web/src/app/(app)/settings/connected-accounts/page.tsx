'use client';

/**
 * The Connected accounts settings section.
 *
 * @remarks
 * Lists the external **identities** (Google accounts) the user has linked to their Docket
 * identity, with add/remove. Identities are user-scoped (the OAuth grant belongs to the user, not
 * an org) — distinct from a workspace's own **Connections**, which *pick* an identity + resources
 * to sync. Linking happens only here. Previously lived at
 * `/orgs/[orgId]/settings/connected-accounts` (personal workspace only); moved here since the
 * feature was never actually workspace-scoped.
 *
 * Data is fetched at runtime, so the production build needs no running server.
 */
import type { JSX } from 'react';

import { ConnectedAccountsTab } from '@/components/settings/connected-accounts-tab';
import { SectionHeader } from '@/components/settings/section-header';
import { usePersonalWorkspaceId } from '@/components/settings/use-personal-workspace-id';

/** The global Connected accounts destination. */
export default function GlobalConnectedAccountsSettingsPage(): JSX.Element {
  const orgId = usePersonalWorkspaceId();

  if (!orgId) {
    return <p className="text-on-surface-variant text-body-medium">Loading connected accounts…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Connected accounts"
        description="External accounts linked to your Docket identity. Connections sync resources from these."
      />
      <ConnectedAccountsTab orgId={orgId} />
    </div>
  );
}
