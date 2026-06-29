'use client';

/**
 * The Connected accounts settings section.
 *
 * @remarks
 * Reached at `/orgs/[orgId]/settings/connected-accounts` (personal workspace only — see
 * {@link PERSONAL_SETTINGS_SECTION_GROUPS}, "Account" group). Lists the external **identities**
 * (Google accounts) the user has linked to their Docket identity, with add/remove. Identities are
 * user-scoped (the OAuth grant belongs to the user, not an org) — distinct from org-scoped
 * **Connections**, which *pick* an identity + resources to sync. Linking happens only here.
 *
 * Data is fetched at runtime, so the production build needs no running server.
 */
import { use, type JSX } from 'react';

import { ConnectedAccountsTab } from '@/components/settings/connected-accounts-tab';
import { SectionHeader } from '@/components/settings/section-header';

/** The Connected accounts section page. */
export default function ConnectedAccountsSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): JSX.Element {
  const { orgId } = use(params);

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
