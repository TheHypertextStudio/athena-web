'use client';

/**
 * The Security settings section (account recovery codes).
 *
 * @remarks
 * Reached at `/orgs/[orgId]/settings/security` (personal workspace only — see
 * {@link PERSONAL_SETTINGS_SECTION_GROUPS}, "Account" group). Recovery codes are a person-level
 * concern, not an org-level one, so this page guards against a shared org: if the active org is not
 * personal it redirects to the org default section and renders a calm placeholder, keeping the
 * route unreachable from the (shared-org) nav and via a typed URL.
 *
 * Data is fetched at runtime, so the production build needs no running server.
 */
import { type JSX, use, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useActiveOrg } from '@/components/active-org';
import { SectionHeader } from '@/components/settings/section-header';
import { defaultSettingsSection, sectionHref } from '@/components/settings/sections';
import { SecurityTab } from '@/components/settings/security-tab';

/** The Security section page. */
export default function SecuritySettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): JSX.Element {
  const { orgId } = use(params);
  const router = useRouter();
  const { activeOrg } = useActiveOrg();
  const isPersonal = activeOrg?.isPersonal ?? false;

  // Recovery codes are personal-only; send a shared org to its default section.
  useEffect(() => {
    if (activeOrg && !isPersonal) {
      router.replace(sectionHref(orgId, defaultSettingsSection(false)));
    }
  }, [activeOrg, isPersonal, orgId, router]);

  if (activeOrg && !isPersonal) {
    return (
      <p className="text-on-surface-variant text-body" role="status">
        Opening settings&hellip;
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Security"
        description="Generate recovery codes to get back in if you lose your passkey."
      />
      <SecurityTab />
    </div>
  );
}
