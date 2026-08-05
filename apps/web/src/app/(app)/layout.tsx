import { HydrationBoundary } from '@tanstack/react-query';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { type JSX, type ReactNode } from 'react';

import { AppShellFrame } from '@/components/app-shell-frame';
import RouteSlot from '@/components/pwa/route-slot';
import { AppLocationProvider } from '@/lib/app-location';
import { unwrap } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';
import { dehydrate, getServerApi, getServerQueryClient } from '@/lib/query-server';
import { readServerSession } from '@/lib/server-session';

/** Where a signed-out request is returned to when the middleware could not supply its path. */
const DEFAULT_RETURN_PATH = '/today';

/**
 * Layout for the authenticated `(app)` route group.
 *
 * @remarks
 * A Server Component that wraps every authenticated page in the one persistent client
 * {@link AppShellFrame}. Session, workspace, and page loading update regions inside that shared
 * shell; the layout itself is never replaced by a loading or Suspense fallback.
 *
 * The access check is server-side, and that is the whole point: a client-side check necessarily
 * paints first — a `useEffect` runs after the browser has already committed a frame — so the person
 * sees a screen for a beat before being moved off it. Deciding here means the browser receives a
 * redirect instead of a document, and there is nothing to flash. It is also what makes
 * protected-route enforcement real: before this, a signed-out browser navigating to `/today` stayed
 * on `/today` behind a dismissible "Sign in to continue" dialog.
 *
 * Only `'signed-out'` redirects. `'unknown'` — the server could not reach its own API — renders
 * normally with no server-confirmed identity, because redirecting on "could not ask" is exactly how
 * an app ends up shoving a sign-in screen at someone whose session is perfectly valid.
 *
 * The caller's organizations are prefetched here under the same `queryKeys.orgs()` key
 * {@link AppShellFrame} reads, so the sidebar's workspace switcher hydrates from data rather than a
 * skeleton. A failed prefetch degrades gracefully: nothing is cached and the client fetches it.
 *
 * @param props - The route group's children.
 * @returns The authenticated shell wrapping the active page.
 */
export default async function AppGroupLayout({
  children,
}: {
  children: ReactNode;
}): Promise<JSX.Element> {
  const session = await readServerSession();
  // The path this document is being rendered for. Read once and handed to the client, because it is
  // the only thing that can tell a replayed document from a fresh one: offline the worker answers a
  // navigation with whatever document it has, and the browser's URL is then the route the person
  // asked for while this is the route the HTML was built for.
  const serverPath = (await headers()).get('x-docket-pathname');

  if (session.state === 'signed-out') {
    redirect(
      `/sign-in?${new URLSearchParams({ callbackURL: serverPath ?? DEFAULT_RETURN_PATH }).toString()}`,
    );
  }

  const queryClient = getServerQueryClient();
  const api = await getServerApi();
  await queryClient.prefetchQuery({
    queryKey: queryKeys.orgs(),
    queryFn: () => unwrap(() => api.v1.orgs.$get(), 'Could not load your organizations.'),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {/* Outermost inside the group, because everything below reads the URL through it — including
          the shell itself. It has to be here rather than in `AppShellFrame` so that a document
          replayed for some other route still resolves the *requested* route, not the one the
          document was rendered for. */}
      <AppLocationProvider serverPath={serverPath}>
        <AppShellFrame initialSession={session.state === 'authenticated' ? session.user : null}>
          {/* Renders `children` untouched whenever this document is being used for its own route,
              which is every online load. It only diverges when the worker replayed it elsewhere. */}
          <RouteSlot serverPath={serverPath}>{children}</RouteSlot>
        </AppShellFrame>
      </AppLocationProvider>
    </HydrationBoundary>
  );
}
