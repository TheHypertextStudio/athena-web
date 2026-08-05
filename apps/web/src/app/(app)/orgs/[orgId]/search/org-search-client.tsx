'use client';

import type { JSX } from 'react';

import { SearchClient } from '@/components/search/search-client';
import { useAppLocation } from '@/lib/app-location';

/**
 * Workspace-scoped authenticated search.
 *
 * @remarks
 * Split out of `page.tsx` so the route has one client entry point the offline route table can mount
 * directly; see `scripts/offline-route-policy.ts` for why every route needs one.
 *
 * The workspace id comes from {@link useAppLocation} rather than from a prop the page resolved,
 * because offline there is no page render to resolve it — the route table mounts this component
 * straight from the URL.
 *
 * @returns The workspace-scoped search surface.
 */
export default function OrgSearchClient(): JSX.Element {
  const { params } = useAppLocation();
  const orgId = typeof params['orgId'] === 'string' ? params['orgId'] : '';
  return <SearchClient scope="org" orgId={orgId} />;
}
