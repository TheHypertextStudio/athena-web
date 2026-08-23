'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type JSX,
  type ReactNode,
} from 'react';

import {
  buildAuthenticatedHref,
  parseAuthenticatedRoute,
  type AuthenticatedRoute,
  type AuthenticatedRouteParams,
} from './authenticated-route';
import type { AuthenticatedRoutePattern } from './offline-routes.generated';
import { ROUTE_PATTERNS } from './offline-routes.generated';
import {
  ResponsiveNavigationProvider,
  type ResponsiveNavigationOptions,
} from './interactions/navigation';
import { matchRoutes } from './route-match';

/**
 * The one place the app learns which URL it is on.
 *
 * @remarks
 * **`window.location` is the authority here, and Next's router is only a change notification.**
 * That inversion is the point of the file, and it is what makes offline rendering possible.
 *
 * Offline, the service worker answers a navigation it has no document for with a *different*
 * route's document — the cached app shell. Next then hydrates believing it is on the route that
 * document was rendered for, so `usePathname()` reports the shell's path while the address bar, and
 * the person, are on the route they actually asked for. Anything reading `usePathname` or
 * `useParams` directly would resolve the wrong route, look up the wrong workspace, and fetch the
 * wrong entity. Reading `window.location` is correct in both cases at once, because it is correct
 * by definition: it is the URL.
 *
 * Route params come from matching that pathname against the generated route table rather than from
 * `useParams`, for the same reason. The shapes match exactly — a catch-all yields an array,
 * everything else a string — so a call site moving here does not change how it reads a param.
 *
 * ESLint forbids importing `usePathname`, `useParams` or `useSearchParams` from `next/navigation`
 * anywhere but this file.
 */

/** Everything a surface can ask about the current URL. */
export interface AppLocation {
  /** The pathname, with no query string or hash. */
  readonly pathname: string;
  /** Route params for the matched pattern, shaped as Next's `useParams` returns them. */
  readonly params: Readonly<Record<string, string | readonly string[]>>;
  /** The query string. */
  readonly searchParams: URLSearchParams;
}

/** `pathname + search`, the single string the store keeps. */
type Href = string;

/** Subscribers to the location store. */
const listeners = new Set<() => void>();

/**
 * The last href handed out, kept only so repeated reads return an identical string.
 *
 * @remarks
 * Not the source of truth. {@link getSnapshot} re-reads `window.location` on every call, because a
 * cached value would be one commit stale on an online navigation — long enough for a freshly
 * mounted detail page to compute its params from the *previous* URL and fetch the entity the person
 * just navigated away from.
 */
let current: Href = '';

/** Read the browser's current href, in the store's `pathname + search` form. */
function readWindowHref(): Href {
  return `${window.location.pathname}${window.location.search}`;
}

/**
 * Tell every subscriber to re-read the location.
 *
 * @remarks
 * Notification only. Subscribers that re-render for their own reasons already see the current URL,
 * because the snapshot is read live rather than pushed.
 */
export function syncLocation(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Move to a new URL without involving Next's router.
 *
 * @remarks
 * Used while the server is unreachable, where the router's navigation would fetch an RSC payload,
 * fail, and fall back to a full document load — tearing down a live app shell for a navigation that
 * needed no network at all. Pushing history directly keeps the shell mounted and lets the route
 * table swap the page underneath it.
 *
 * @param href - The destination, as a same-origin path with optional query.
 */
export function navigateWithoutRouter(href: string): void {
  navigateHistory(href, false, true);
}

function navigateHistory(href: string, replace: boolean, scroll: boolean): void {
  if (replace) window.history.replaceState(null, '', href);
  else window.history.pushState(null, '', href);
  syncLocation();
  if (scroll) window.scrollTo({ left: 0, top: 0 });
}

/** Options for one validated browser-history navigation. */
export interface AuthenticatedNavigationOptions {
  /** Replace the current history entry instead of pushing a new one. */
  readonly replace?: boolean;
  /** Scroll the destination to the top. Defaults to true. */
  readonly scroll?: boolean;
}

/**
 * Validate and commit one generated authenticated route without asking Next for an RSC transition.
 *
 * @param pattern - A generated authenticated route pattern.
 * @param params - Parameters correlated with that exact pattern.
 * @param options - Browser history behavior.
 */
export function navigateAuthenticated<TPattern extends AuthenticatedRoutePattern>(
  pattern: TPattern,
  params: AuthenticatedRouteParams<TPattern>,
  options: AuthenticatedNavigationOptions = {},
): void {
  navigateHistory(
    buildAuthenticatedHref(pattern, params),
    options.replace === true,
    options.scroll !== false,
  );
}

/** Subscribe to location changes. */
function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

/** The client snapshot, always read live from the browser. */
function getSnapshot(): Href {
  const next = readWindowHref();
  if (next !== current) {
    current = next;
  }
  return current;
}

/**
 * The href the server rendered this document for, or `null` when no provider is mounted.
 *
 * @remarks
 * Carried through context rather than a module variable so the value belongs to the tree being
 * rendered, not to the module — a module-scope assignment during render is a side effect that
 * outlives the request that made it.
 */
const ServerHrefContext = createContext<Href | null>(null);

/** Props for {@link AppLocationProvider}. */
export interface AppLocationProviderProps {
  /**
   * The path this document was server-rendered for, from `x-docket-pathname`.
   *
   * @remarks
   * Not `usePathname()`, even though that is available here. Next derives its canonical URL from
   * `window.location` in the browser, so during hydration `usePathname()` already reports the URL
   * the person is on — which, for a document the worker replayed under another route, is *not* the
   * URL this HTML was built for. Using it as the server snapshot would make the first client render
   * disagree with the markup and turn every offline navigation into a hydration error.
   *
   * `null` when the proxy supplied no header; the browser's own URL is then used from the first
   * render, which is correct for every document that was not replayed.
   */
  readonly serverPath: string | null;
  /** The subtree that may read the location. */
  readonly children: ReactNode;
}

/**
 * Keep location subscribers in step with Next's router, and mark the location readable.
 *
 * @remarks
 * The provider does not *supply* the location — the store does, so non-React code can read and move
 * it too. What the provider contributes is the change notification: it re-renders whenever Next's
 * router moves, and tells subscribers to re-read. Offline the router never moves, and
 * {@link navigateWithoutRouter} notifies instead.
 *
 * It also supplies the server snapshot. `useSyncExternalStore` calls that during SSR *and* during
 * hydration, then compares it with the client snapshot and re-renders if they differ — which is
 * exactly what the mismatched-document case needs. The first client render matches the server's
 * HTML, and the real URL is applied in a follow-up render rather than as a hydration error.
 */
export function AppLocationProvider({
  serverPath,
  children,
}: AppLocationProviderProps): JSX.Element {
  const routerPathname = usePathname();
  const routerSearch = useSearchParams();

  // The document's own path when the proxy named it; otherwise fall back to the router, which is
  // right for every document that was not replayed.
  const serverHref =
    serverPath ??
    (routerSearch.size > 0 ? `${routerPathname}?${routerSearch.toString()}` : routerPathname);
  const getServerSnapshot = useCallback(() => serverHref, [serverHref]);
  const locationHref = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const navigate = useCallback(
    (href: string, replace: boolean, options?: ResponsiveNavigationOptions): boolean => {
      const queryAt = href.indexOf('?');
      const pathname = queryAt === -1 ? href : href.slice(0, queryAt);
      if (parseAuthenticatedRoute(pathname).kind !== 'matched') return false;
      navigateHistory(href, replace, options?.scroll !== false);
      return true;
    },
    [],
  );

  useEffect(() => {
    syncLocation();
  }, [routerPathname, routerSearch]);

  // Back and forward move the URL without going through either the router or our own navigation.
  useEffect(() => {
    window.addEventListener('popstate', syncLocation);
    return () => {
      window.removeEventListener('popstate', syncLocation);
    };
  }, []);

  return (
    <ServerHrefContext.Provider value={serverHref}>
      <ResponsiveNavigationProvider canonicalHref={locationHref} navigate={navigate}>
        {children}
      </ResponsiveNavigationProvider>
    </ServerHrefContext.Provider>
  );
}

/**
 * The current URL, its route params, and its query string.
 *
 * @remarks
 * Throws when {@link AppLocationProvider} is not mounted above the caller, rather than quietly
 * falling back to Next's hooks. A silent fallback would work online and break only offline, which
 * is the failure this module exists to remove.
 *
 * @returns The current location.
 * @throws {Error} When the provider is not mounted.
 */
export function useAppLocation(): AppLocation {
  const serverHref = useContext(ServerHrefContext);
  const getServerSnapshot = useCallback(() => serverHref ?? '/', [serverHref]);
  const href = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const location = useMemo(() => {
    const queryAt = href.indexOf('?');
    const pathname = queryAt === -1 ? href : href.slice(0, queryAt);
    const search = queryAt === -1 ? '' : href.slice(queryAt + 1);
    return {
      pathname,
      params: matchRoutes(ROUTE_PATTERNS, pathname)?.params ?? {},
      searchParams: new URLSearchParams(search),
    };
  }, [href]);

  if (serverHref === null) {
    throw new Error('AppLocationProvider is not mounted above this component.');
  }
  return location;
}

/**
 * The current route's params.
 *
 * @remarks
 * The direct replacement for `useParams`, down to the unchecked generic: the caller names the shape
 * it expects and gets it, exactly as Next's hook behaves. Keeping the signature identical is what
 * let every existing call site move here by changing its import and nothing else.
 *
 * A route with a catch-all segment yields an array for that param, so a caller naming it `string`
 * would be wrong — the same way it would be wrong with `useParams`.
 *
 * @typeParam T - The params this route is expected to carry.
 * @returns The params for the matched route.
 */
// The type parameter appears once and is therefore an unchecked cast rather than a real generic —
// which is exactly what Next's `useParams<T>()` is too. Matching that signature is what let 20 call
// sites move here by changing an import and nothing else, and narrowing it to the union the matcher
// actually returns would have meant editing every one of them to re-narrow at the use site.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function useAppParams<T extends Record<string, string | readonly string[]>>(): T {
  return useAppLocation().params as T;
}

/**
 * Read one exact generated route and its runtime-validated, branded parameters.
 *
 * @param pattern - The route pattern the mounted component implements.
 * @returns The matched route with parameters correlated to that pattern.
 * @throws {Error} When the current URL is invalid or names a different route.
 */
export function useTypedRoute<TPattern extends AuthenticatedRoutePattern>(
  pattern: TPattern,
): Extract<AuthenticatedRoute, { readonly pattern: TPattern }> {
  const { pathname } = useAppLocation();
  const result = parseAuthenticatedRoute(pathname);
  if (result.kind !== 'matched' || result.route.pattern !== pattern) {
    throw new Error(`Expected authenticated route ${pattern}.`);
  }
  return result.route as Extract<AuthenticatedRoute, { readonly pattern: TPattern }>;
}

/**
 * The current pathname, with no query string.
 *
 * @remarks
 * The direct replacement for `usePathname`. See {@link useAppLocation} for why the router's answer
 * is not the one to trust.
 *
 * @returns The pathname.
 */
export function useAppPathname(): string {
  return useAppLocation().pathname;
}

/**
 * The current query string.
 *
 * @remarks
 * The direct replacement for `useSearchParams`. The returned object is shared by every caller for
 * as long as the URL does not change, so treat it as read-only — mutating it would corrupt what the
 * next caller reads. Build a copy with `new URLSearchParams(searchParams.toString())` to change
 * anything, which is what every call site already does.
 *
 * @returns The parsed query string.
 */
export function useAppSearchParams(): URLSearchParams {
  return useAppLocation().searchParams;
}
