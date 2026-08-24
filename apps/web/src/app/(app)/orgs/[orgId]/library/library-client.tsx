'use client';

import type { JSX } from 'react';

import LibraryClient from '@/components/library/library-client';
import { useTypedRoute } from '@/lib/app-location';

/**
 * The Library route's client entry point.
 *
 * @remarks
 * `page.tsx` is a Server Component that prefetches the roster and hydrates it, so the route has no
 * client body of its own. The offline route table needs one: with no network there is no server to
 * run the page, so the table mounts the route's *client* module directly and finds it by looking
 * for a sibling `*-client.tsx` (see `scripts/offline-route-policy.ts`).
 *
 * It also mounts that module with **no props**, which is why this is a component rather than a
 * re-export: `LibraryClient` needs an `orgId`, and offline the only place to get one is the URL.
 * `useAppParams` reads it from there, so the route renders the same either side of a network.
 *
 * @returns the Library roster for the org in the current URL.
 */
export default function LibraryRouteClient(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/library');
  return <LibraryClient orgId={orgId} />;
}
