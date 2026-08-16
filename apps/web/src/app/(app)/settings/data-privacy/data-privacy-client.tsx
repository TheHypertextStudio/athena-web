'use client';

import type { JSX } from 'react';

import { DangerZoneTab } from '@/components/settings/danger-zone-tab';
import { ExportDataTab } from '@/components/settings/export-data-tab';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';

/**
 * The user-owned data export and deletion surface.
 *
 * @remarks
 * Split out of `page.tsx` so the route has one client entry point the offline route table can mount
 * directly; see `scripts/offline-route-policy.ts` for why every route needs one.
 *
 * @returns The export and account-deletion sections.
 */
export default function DataPrivacyClient(): JSX.Element {
  return (
    <SettingsSectionPage title="Data & privacy" description="Export or delete your Docket data.">
      <section className="flex flex-col gap-4">
        <h2 className="text-on-surface text-title-small">Export data</h2>
        <ExportDataTab />
      </section>
      <section className="flex flex-col gap-4 pt-6">
        <h2 className="text-on-surface text-title-small">Delete account</h2>
        <DangerZoneTab />
      </section>
    </SettingsSectionPage>
  );
}
