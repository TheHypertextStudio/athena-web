'use client';

import type { JSX } from 'react';

import { SearchClient } from '@/components/search/search-client';
import { useTypedRoute } from '@/lib/app-location';

/**
 * Workspace-scoped authenticated search.
 *
 * @remarks
 * Split out of `page.tsx` so the route has one client entry point the offline route table can mount
 * directly; see `scripts/offline-route-policy.ts` for why every route needs one.
 *
 * The workspace id comes from {@link useTypedRoute} rather than from a prop the page resolved,
 * because offline there is no page render to resolve it — the route table mounts this component
 * straight from the URL.
 *
 * @returns The workspace-scoped search surface.
 */
export default function OrgSearchClient(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/search');
  return <SearchClient scope="org" orgId={orgId} />;
}
