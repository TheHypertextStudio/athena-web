import { HydrationBoundary } from '@tanstack/react-query';
import Link from 'next/link';
import type { JSX } from 'react';

import { AppShellFrame } from '@/components/app-shell-frame';
import { AppContentFallback } from '@/components/app-content-fallback';
import { AppLocationProvider } from '@/lib/app-location';
import { unwrap } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';
import { dehydrate, getServerApi, getServerQueryClient } from '@/lib/query-server';
import { readServerSession } from '@/lib/server-session';

/**
 * The root missing-route boundary.
 *
 * @remarks
 * Next reaches this boundary for a URL that has no resolved route at all. That includes a stale
 * in-app destination such as `/athena/work/:id`, which therefore bypasses `(app)`'s layout and its
 * local `not-found.tsx`. When the request has an authenticated (or presently unknown) session,
 * rebuild the ordinary shell here and replace only its content region. A signed-out visitor still
 * receives a small public 404 instead of authenticated navigation.
 */
export default async function RootNotFound(): Promise<JSX.Element> {
  const session = await readServerSession();

  if (session.state === 'signed-out') {
    return <PublicMissingPage />;
  }

  const queryClient = getServerQueryClient();
  const api = await getServerApi();
  await queryClient.prefetchQuery({
    queryKey: queryKeys.orgs(),
    queryFn: () => unwrap(() => api.v1.orgs.$get(), 'Could not load your organizations.'),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {/* Root misses have no `(app)` layout to provide the location context. `null` deliberately
          trusts the current router URL rather than pretending this 404 was rendered for another
          document, which keeps this recovery surface stable during hydration. */}
      <AppLocationProvider serverPath={null}>
        <AppShellFrame initialSession={session.state === 'authenticated' ? session.user : null}>
          <AppContentFallback kind="not-found" />
        </AppShellFrame>
      </AppLocationProvider>
    </HydrationBoundary>
  );
}

/** A concise public response for a missing URL requested without an app session. */
function PublicMissingPage(): JSX.Element {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-3 px-6 py-12">
      <p className="text-on-surface-variant text-label-large">404</p>
      <h1 className="text-on-surface text-headline-small">This page isn’t available</h1>
      <p className="text-on-surface-variant text-body-large">
        The address may be mistyped, or the page may no longer exist.
      </p>
      <Link href="/" className="text-primary text-label-large mt-2 w-fit">
        Go to Docket home
      </Link>
    </main>
  );
}
