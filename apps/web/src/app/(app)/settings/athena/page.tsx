'use client';

import { useEffect, useState, type JSX } from 'react';

import { SectionHeader } from '@/components/settings/section-header';
import { Button } from '@docket/ui/primitives';

const ATHENA_PREFERENCES_KEY = 'docket:athena-preferences';

/** The user-owned Athena preferences destination. */
export default function GlobalAthenaSettingsPage(): JSX.Element {
  const [instructions, setInstructions] = useState('');
  const [approvalMode, setApprovalMode] = useState('Ask before acting');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const raw = window.localStorage.getItem(ATHENA_PREFERENCES_KEY);
    if (!raw) return;
    try {
      const preferences = JSON.parse(raw) as { instructions?: string; approvalMode?: string };
      setInstructions(preferences.instructions ?? '');
      setApprovalMode(preferences.approvalMode ?? 'Ask before acting');
    } catch {
      window.localStorage.removeItem(ATHENA_PREFERENCES_KEY);
    }
  }, []);

  function savePreferences(): void {
    window.localStorage.setItem(
      ATHENA_PREFERENCES_KEY,
      JSON.stringify({ instructions, approvalMode }),
    );
    setSaved(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Athena" description="Set how your chief of staff works with you." />
      <section className="border-outline-variant flex max-w-2xl flex-col gap-5 rounded-lg border p-5">
        <div>
          <h2 className="text-on-surface text-sm font-semibold">Working preferences</h2>
          <p className="text-on-surface-variant mt-1 text-sm">
            Give Athena durable guidance for how to represent you across Docket and your connected
            services.
          </p>
        </div>
        <label className="text-on-surface flex flex-col gap-1.5 text-sm font-medium">
          Instructions for Athena
          <textarea
            value={instructions}
            onChange={(event) => {
              setInstructions(event.target.value);
              setSaved(false);
            }}
            rows={5}
            placeholder="For example: keep updates concise and flag anything that needs my approval."
            className="border-outline-variant bg-surface text-on-surface placeholder:text-on-surface-variant focus-visible:ring-ring w-full resize-y rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
          />
        </label>
        <label className="text-on-surface flex max-w-md flex-col gap-1.5 text-sm font-medium">
          Approval behavior
          <select
            value={approvalMode}
            onChange={(event) => {
              setApprovalMode(event.target.value);
              setSaved(false);
            }}
            className="border-outline-variant bg-surface text-on-surface focus-visible:ring-ring h-10 rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
          >
            <option>Ask before acting</option>
            <option>Act on routine work</option>
            <option>Suggest only</option>
          </select>
        </label>
        <div className="flex items-center gap-3">
          <Button type="button" onClick={savePreferences}>
            Save Athena preferences
          </Button>
          {saved ? (
            <span className="text-on-surface-variant text-xs" role="status">
              Saved on this device.
            </span>
          ) : null}
        </div>
      </section>
    </div>
  );
}
