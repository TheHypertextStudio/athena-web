import type { JSX } from 'react';

import { SectionHeader } from '@/components/settings/section-header';

/** The user-owned Athena preferences destination. */
export default function GlobalAthenaSettingsPage(): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Athena" description="Set how your chief of staff works with you." />
      <section className="border-outline-variant flex max-w-2xl flex-col gap-2 rounded-lg border p-5">
        <h2 className="text-on-surface text-sm font-semibold">Athena preferences</h2>
        <p className="text-on-surface-variant text-sm">
          Assistant instructions, approval rules, and working preferences will live here.
        </p>
      </section>
    </div>
  );
}
