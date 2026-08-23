'use client';

import { useEffect, useState, type ComponentType, type JSX } from 'react';

import { OfflineContent } from '@/components/offline-state';
import { useAppLocation } from '@/lib/app-location';
import { parseAuthenticatedRoute } from '@/lib/authenticated-route';
import { OFFLINE_ROUTES } from '@/lib/offline-routes.generated';
import { useOnlineStatus } from '@/lib/use-online-status';

/**
 * Renders the real page for whatever URL the browser is on, without a document for it.
 *
 * @remarks
 * This is what makes the offline shell more than a waiting room. The service worker answers a
 * navigation it has no cached document for with the shell document; that document boots the app
 * shell, and this component then loads the route's own client component out of the generated table
 * and mounts it. The page reads the persisted TanStack Query cache exactly as it would online, so a
 * task or project loaded earlier renders in full.
 *
 * Nothing here fabricates data. A route whose entity was never loaded renders its own empty state,
 * and the shell's standing offline banner says the whole screen may be stale.
 *
 * **Three things can go wrong, and each has a distinct honest answer.** No route claims the path —
 * the person typed something, or followed a link to a route this build does not have. The route's
 * chunk was never cached, so the dynamic import rejects; that is the case the precached chunk set
 * exists to make rare, and it stays possible for anything excluded from it. Or the chunk is still
 * arriving, which is a frame or two from disk. The first two land on {@link OfflineContent}; the
 * third renders nothing rather than flashing a skeleton for a load measured in milliseconds.
 */

/** What the outlet knows about the route it is trying to render. */
type OutletState =
  | { readonly pathname: string; readonly status: 'loading' }
  | { readonly pathname: string; readonly status: 'ready'; readonly Component: ComponentType }
  | {
      readonly pathname: string;
      readonly status: 'unavailable';
      readonly reason: 'module' | 'not-found';
    };

/**
 * Load and render the route component for the current URL.
 *
 * @returns The route's own UI, or the offline content state when it cannot be rendered.
 */
export default function OfflineRouteOutlet(): JSX.Element | null {
  const { pathname } = useAppLocation();
  const online = useOnlineStatus();
  const [state, setState] = useState<OutletState>({ pathname, status: 'loading' });

  useEffect(() => {
    const match = parseAuthenticatedRoute(pathname);
    const entry =
      match.kind === 'matched'
        ? OFFLINE_ROUTES.find((route) => route.pattern === match.route.pattern)
        : undefined;

    if (!entry) {
      setState({ pathname, status: 'unavailable', reason: 'not-found' });
      return undefined;
    }

    // The pathname can change under us — offline navigation swaps the route without unmounting the
    // shell — so a load that resolves after the person has moved on must not be rendered.
    let current = true;
    setState({ pathname, status: 'loading' });
    entry
      .load()
      .then((Component) => {
        if (current) {
          setState({ pathname, status: 'ready', Component });
        }
      })
      .catch(() => {
        // The chunk is not in the cache and there is no network to fetch it from. Nothing is broken;
        // this route simply is not available on this device right now.
        if (current) {
          setState({ pathname, status: 'unavailable', reason: 'module' });
        }
      });

    return () => {
      current = false;
    };
  }, [pathname]);

  if (state.pathname !== pathname || state.status === 'loading') {
    return null;
  }
  if (state.status === 'unavailable') {
    if (state.reason === 'not-found') {
      return (
        <div className="flex h-full items-center justify-center p-6">
          <p role="alert" className="text-on-surface-variant text-body-medium">
            Page not found.
          </p>
        </div>
      );
    }
    return <OfflineContent online={online} />;
  }
  return <state.Component key={pathname} />;
}
