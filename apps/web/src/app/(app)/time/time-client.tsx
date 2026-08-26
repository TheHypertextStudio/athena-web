'use client';

import { useEffect, useState, type JSX } from 'react';

import { TimeAnalytics, TimeSharePanel } from '@/components/time-tracking';

/**
 * The time-reports surface.
 *
 * @remarks
 * Split out of `page.tsx` so the route has one client entry point the offline route table can
 * mount directly. A Server Component cannot be rendered without a server, so a route whose UI lives
 * in its page body has no offline behaviour at all; `scripts/offline-route-policy.ts` enforces the
 * split rather than leaving it to memory.
 *
 * @returns The analytics surface plus the current-task share controls.
 */
export default function TimeClient(): JSX.Element {
  const [hydrated, setHydrated] = useState(false);

  // The report's first render depends on browser-resolved review state. Production proved that
  // it can differ from the server document and abort hydration. Keep the document's first frame
  // deterministic, then mount the report after React owns this subtree.
  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <div className="flex h-full min-w-0 flex-col">
      {hydrated ? (
        <>
          <TimeAnalytics />
          <TimeSharePanel />
        </>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6" aria-busy="true">
          <span className="text-on-surface-variant text-body-medium">Loading time review</span>
        </div>
      )}
    </div>
  );
}
