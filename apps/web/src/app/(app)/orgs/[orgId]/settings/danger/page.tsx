'use client';

/**
 * The Danger zone settings section (account end-of-life).
 *
 * @remarks
 * Reached at `/orgs/[orgId]/settings/danger` (personal workspace only — see
 * {@link PERSONAL_SETTINGS_SECTION_GROUPS}, "Account" group). Account deletion is a
 * person-level action, not an org-level one, so this page guards against a shared org: if the
 * active org is not personal it redirects to the org default section and renders a calm
 * placeholder, keeping the route unreachable from the (shared-org) nav and via a typed URL.
 *
 * Data is fetched at runtime, so the production build needs no running server.
 */
import { use, useEffect, type JSX } from 'react';
import { useRouter } from 'next/navigation';

import { useActiveOrg } from '@/components/active-org';
import { DangerZoneTab } from '@/components/settings/danger-zone-tab';
import { SectionHeader } from '@/components/settings/section-header';
import { defaultSettingsSection, sectionHref } from '@/components/settings/sections';

/** The Danger zone section page. */
export default function DangerZoneSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): JSX.Element {
  const { orgId } = use(params);
  const router = useRouter();
  const { activeOrg } = useActiveOrg();
  const isPersonal = activeOrg?.isPersonal ?? false;

  // Account deletion is personal-only; send a shared org to its default section.
  useEffect(() => {
    if (activeOrg && !isPersonal) {
      router.replace(sectionHref(orgId, defaultSettingsSection(false)));
    }
  }, [activeOrg, isPersonal, orgId, router]);

  if (activeOrg && !isPersonal) {
    return (
      <p className="text-on-surface-variant text-body-medium" role="status">
        Opening settings&hellip;
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Danger zone"
        description="Permanently delete your account and personal data."
      />
      <DangerZoneTab />
    </div>
  );
}
