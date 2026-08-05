'use client';

import type { JSX } from 'react';

import { SearchClient } from '@/components/search/search-client';

/**
 * Cross-workspace authenticated search.
 *
 * @remarks
 * Split out of `page.tsx` so the route has one client entry point the offline route table can mount
 * directly; see `scripts/offline-route-policy.ts` for why every route needs one.
 *
 * @returns The Hub-scoped search surface.
 */
export default function HubSearchClient(): JSX.Element {
  return <SearchClient scope="hub" />;
}
