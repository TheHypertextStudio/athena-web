'use client';

import type { JSX } from 'react';

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
  return (
    <div className="flex h-full min-w-0 flex-col">
      <TimeAnalytics />
      <TimeSharePanel />
    </div>
  );
}
