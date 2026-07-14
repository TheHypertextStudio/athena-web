'use client';

/**
 * The Export data settings section.
 *
 * @remarks
 * Reached at `/orgs/[orgId]/settings/export` (personal workspace only — see
 * {@link PERSONAL_SETTINGS_SECTION_GROUPS}, "Account" group). Requesting a personal-data export is
 * a person-level action, so this page guards against a shared org: if the active org is not
 * personal it redirects to the org default section and renders a calm placeholder.
 *
 * Data is fetched at runtime, so the production build needs no running server.
 */
import { use, useEffect, type JSX } from 'react';
import { useRouter } from 'next/navigation';

import { useActiveOrg } from '@/components/active-org';
import { ExportDataTab } from '@/components/settings/export-data-tab';
import { SectionHeader } from '@/components/settings/section-header';
import { defaultSettingsSection, sectionHref } from '@/components/settings/sections';

/** The Export data section page. */
export default function ExportDataSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): JSX.Element {
  const { orgId } = use(params);
  const router = useRouter();
  const { activeOrg } = useActiveOrg();
  const isPersonal = activeOrg?.isPersonal ?? false;

  // Personal-data export is personal-only; send a shared org to its default section.
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
      <SectionHeader title="Export data" description="Download a copy of everything in Docket." />
      <ExportDataTab />
    </div>
  );
}
