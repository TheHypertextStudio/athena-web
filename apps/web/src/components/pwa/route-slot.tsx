'use client';

import type { JSX, ReactNode } from 'react';

import OfflineRouteOutlet from '@/components/pwa/offline-route-outlet';
import { useAppLocation } from '@/lib/app-location';

/**
 * Renders the page this document was built for, or — when the worker replayed this document under
 * some other URL — the page that URL actually asks for.
 *
 * @remarks
 * This is what lets **any** cached document act as an app shell for **any** route, which is the
 * whole offline story in one component.
 *
 * Offline, the service worker has a document for some routes and none for most: Docket's routes are
 * mostly parameterized, so `/orgs/[orgId]/tasks/[taskId]` can never have been pre-visited. Rather
 * than keep a dedicated shell document — which would mean a route in the product's URL space that
 * exists for infrastructure reasons, plus a fetch per user per release to warm it — the worker
 * answers with whatever document it already has, and this notices.
 *
 * The comparison is honest and cheap: the layout knows, server-side, which path it rendered for
 * (`x-docket-pathname`, already set by `proxy.ts`), and the browser knows which path it is on. Equal
 * means this document is being used as intended, so `children` — the real server-rendered page, with
 * its own prefetched data — renders untouched. Different means it is standing in for another route,
 * and {@link OfflineRouteOutlet} mounts that route's own component from the generated table.
 *
 * The comparison reads {@link useAppLocation} rather than `window.location` directly, and that is
 * load-bearing in two ways. During hydration the location store reports the document's own path, so
 * the first client render reproduces the server HTML exactly and the real URL arrives in a follow-up
 * render rather than as a hydration error. And offline navigation writes to that same store, so a
 * click that swaps the route re-renders this — without it, the previous page would stay on screen
 * under the new URL, which is the exact lie the whole component exists to prevent.
 *
 * Online this is inert: the two paths always agree, so `children` renders and nothing is probed,
 * loaded, or compared beyond one string equality.
 */

/** Props for {@link RouteSlot}. */
export interface RouteSlotProps {
  /**
   * The path this document was server-rendered for.
   *
   * @remarks
   * `null` when the proxy did not supply one, which means nothing can be compared — so the document
   * is trusted and `children` renders, exactly as before this existed.
   */
  readonly serverPath: string | null;
  /** The route Next resolved for this document. */
  readonly children: ReactNode;
}

/**
 * Render the requested route, whichever document delivered the shell.
 *
 * @param props - The document's own path and the page Next resolved.
 * @returns The page, or the outlet when this document is standing in for another route.
 */
export default function RouteSlot({ serverPath, children }: RouteSlotProps): JSX.Element {
  const { pathname } = useAppLocation();
  const replayed = serverPath !== null && pathOf(serverPath) !== pathname;

  return replayed ? <OfflineRouteOutlet /> : <>{children}</>;
}

/** The path part of a value that may carry a query string. */
function pathOf(value: string): string {
  const queryAt = value.indexOf('?');
  return queryAt === -1 ? value : value.slice(0, queryAt);
}
