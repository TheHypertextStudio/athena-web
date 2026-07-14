import type { JSX } from 'react';

import { SectionHeader } from '@/components/settings/section-header';
import { ExportDataTab } from '@/components/settings/export-data-tab';
import { DangerZoneTab } from '@/components/settings/danger-zone-tab';

/** The user-owned data export and deletion destination. */
export default function GlobalDataPrivacySettingsPage(): JSX.Element {
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
