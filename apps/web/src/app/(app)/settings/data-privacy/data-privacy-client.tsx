'use client';

import type { JSX } from 'react';

import { DangerZoneTab } from '@/components/settings/danger-zone-tab';
import { ExportDataTab } from '@/components/settings/export-data-tab';
import { SectionHeader } from '@/components/settings/section-header';

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
    <div className="flex flex-col gap-8">
      <SectionHeader title="Data & privacy" description="Export or delete your Docket data." />
      <section className="flex flex-col gap-4">
        <h2 className="text-on-surface text-sm font-semibold">Export data</h2>
        <ExportDataTab />
      </section>
      <section className="border-outline-variant flex flex-col gap-4 border-t pt-6">
        <h2 className="text-on-surface text-sm font-semibold">Delete account</h2>
        <DangerZoneTab />
      </section>
    </div>
  );
}
