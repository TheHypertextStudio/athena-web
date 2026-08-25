'use client';

import { cn } from '@docket/ui/lib/utils';
import { QueryClientContext, type DefaultError, type UseQueryOptions } from '@tanstack/react-query';
import Link from 'next/link';
import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ComponentProps,
  type JSX,
  type MouseEvent,
} from 'react';

import { useServerReachable } from '@/components/reachability';
import { navigateWithoutRouter } from '@/lib/app-location';
import { parseAuthenticatedRoute, prefetchAuthenticatedRoute } from '@/lib/authenticated-route';
import {
  initiativeDetailAggregateDef,
  programDetailAggregateDef,
  projectDetailAggregateDef,
  taskDetailAggregateDef,
} from '@/lib/detail-aggregate';
import { useOptionalResponsiveRouter } from '@/lib/interactions/navigation';
import { useOfflineAvailability } from '@/lib/offline-availability';
import { useOnlineStatus } from '@/lib/use-online-status';

/**
 * The app's link. Behaves as `next/link` while the server answers, and keeps the shell mounted when
 * it does not.
 *
 * @remarks
 * Offline, a `next/link` click is not a cheap no-op — it is the most expensive thing on the page.
 * Next fetches an RSC payload for the destination, the request fails, and the router falls back to a
 * full document navigation. That tears down a perfectly healthy running application, throws away
 * scroll position, open tabs and anything half-typed, and hands the browser to the service worker
 * for a navigation that never needed the network in the first place.
 *
 * So while the server is unreachable, this pushes history directly and lets the location store tell
 * the route table to swap the page underneath the shell. Nothing unmounts, nothing reloads, and the
 * back button still works because the history entry is real.
 *
 * The shell's request-backed reachability remains authoritative when the browser reports an
 * interface, because `navigator.onLine === true` cannot prove the server is reachable. Its
 * negative answer is definitive, though: reacting to the browser's `offline` event closes the gap
 * before a later session request has time to fail.
 *
 * Only plain left clicks are intercepted. A modified click (new tab, new window, download) is the
 * browser's business and is left alone, exactly as `next/link` leaves it alone.
 */

/** Props for {@link DocketLink}: `next/link`'s, unchanged. */
export type DocketLinkProps = ComponentProps<typeof Link>;

const MODULE_PREFETCH_DELAY_MS = 75;

type PrefetchApi = <T>(definition: UseQueryOptions<T, DefaultError, T>) => void;

/**
 * Navigate without losing the shell when there is no server to ask.
 *
 * @param props - `next/link`'s props.
 * @returns The link.
 */
export default function DocketLink({
  onClick,
  onBlur,
  onFocus,
  onMouseEnter,
  onMouseLeave,
  prefetch,
  ...props
}: DocketLinkProps): JSX.Element {
  const serverReachable = useServerReachable();
  const online = useOnlineStatus();
  const routerReachable = serverReachable && online;
  const responsiveRouter = useOptionalResponsiveRouter();
  const href = typeof props.href === 'string' ? props.href : null;
  const localRoute = href?.startsWith('/') === true && routePathIsAuthenticated(href);
  const availability = useOfflineAvailability(href, !routerReachable);
  const navigationPending = responsiveRouter?.requestedHref === href;
  const prefetchTimer = useRef<number | null>(null);
  const queryClient = useContext(QueryClientContext);
  const prefetchApi = useCallback<PrefetchApi>(
    (definition) => {
      if (queryClient !== undefined) void queryClient.prefetchQuery(definition);
    },
    [queryClient],
  );

  const cancelIntent = useCallback((): void => {
    if (prefetchTimer.current === null) return;
    window.clearTimeout(prefetchTimer.current);
    prefetchTimer.current = null;
  }, []);

  const handleIntent = useCallback((): void => {
    if (href === null || !localRoute || prefetchTimer.current !== null) return;
    prefetchTimer.current = window.setTimeout(() => {
      prefetchTimer.current = null;
      void prefetchAuthenticatedRoute(href);
      prefetchDetailAggregate(href, prefetchApi);
    }, MODULE_PREFETCH_DELAY_MS);
  }, [href, localRoute, prefetchApi]);

  useEffect(() => cancelIntent, [cancelIntent]);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented) {
      return;
    }
    if (!isPlainLeftClick(event)) {
      return;
    }
    if (href?.startsWith('/') !== true) {
      return;
    }
    cancelIntent();
    if (routerReachable) {
      if (responsiveRouter === null) return;
      const options = props.scroll === undefined ? undefined : { scroll: props.scroll };
      const handled = props.replace
        ? responsiveRouter.replace(href, options)
        : responsiveRouter.push(href, options);
      if (handled) event.preventDefault();
      return;
    }
    event.preventDefault();
    navigateWithoutRouter(href);
  };

  if (availability === 'unavailable') {
    // Only DOM-safe props are carried over. `next/link` accepts `prefetch`, `replace`, `scroll` and
    // friends, and spreading those onto a `span` would put unknown attributes in the document and
    // draw a React warning per row on a list surface.
    const { children, className, id, style, title } = props;
    return (
      <span
        id={id}
        style={style}
        aria-disabled="true"
        // Says why, on hover and to assistive technology, rather than leaving a dimmed word that
        // looks like a rendering bug.
        title={title ?? 'Not available offline'}
        className={cn(className, 'text-on-surface-variant cursor-default opacity-60')}
      >
        {children}
      </span>
    );
  }

  return (
    <Link
      {...props}
      {...(localRoute ? { prefetch: false } : prefetch === undefined ? {} : { prefetch })}
      aria-current={navigationPending ? undefined : props['aria-current']}
      aria-busy={navigationPending || undefined}
      data-navigation-pending={navigationPending || undefined}
      onClick={handleClick}
      onFocus={(event) => {
        onFocus?.(event);
        if (!event.defaultPrevented) handleIntent();
      }}
      onBlur={(event) => {
        onBlur?.(event);
        if (!event.defaultPrevented) cancelIntent();
      }}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        if (!event.defaultPrevented) handleIntent();
      }}
      onMouseLeave={(event) => {
        onMouseLeave?.(event);
        if (!event.defaultPrevented) cancelIntent();
      }}
    />
  );
}

/**
 * Warm query data when the app provider is present without making a link depend on that provider.
 *
 * @remarks
 * `DocketLink` also renders in offline shells, loading layouts, and isolated component trees. Query
 * prefetch is an enhancement for authenticated detail links, so the absence of a query client must
 * not stop the link from rendering or navigating.
 */
function useOptionalPrefetchApi(): ReturnType<typeof usePrefetchApi> {
  const queryClient = useContext(QueryClientContext);
  return useCallback<ReturnType<typeof usePrefetchApi>>(
    (definition) => {
      if (queryClient) void queryClient.prefetchQuery(definition);
    },
    [queryClient],
  );
}

/** Warm the same aggregate query the destination detail route reads. */
function prefetchDetailAggregate(href: string, prefetch: PrefetchApi): void {
  const queryAt = href.indexOf('?');
  const pathname = queryAt === -1 ? href : href.slice(0, queryAt);
  const match = parseAuthenticatedRoute(pathname);
  if (match.kind !== 'matched') return;

  const { params, pattern } = match.route;
  switch (pattern) {
    case '/orgs/[orgId]/tasks/[taskId]':
      prefetch(taskDetailAggregateDef(params.orgId, params.taskId));
      return;
    case '/orgs/[orgId]/projects/[projectId]':
      prefetch(projectDetailAggregateDef(params.orgId, params.projectId));
      return;
    case '/orgs/[orgId]/programs/[programId]':
      prefetch(programDetailAggregateDef(params.orgId, params.programId));
      return;
    case '/orgs/[orgId]/initiatives/[initiativeId]':
      prefetch(initiativeDetailAggregateDef(params.orgId, params.initiativeId));
      return;
    default:
      return;
  }
}

function routePathIsAuthenticated(href: string): boolean {
  const queryAt = href.indexOf('?');
  const pathname = queryAt === -1 ? href : href.slice(0, queryAt);
  return parseAuthenticatedRoute(pathname).kind === 'matched';
}

/**
 * Whether a click means "navigate here, in this tab".
 *
 * @remarks
 * A modifier turns a click into the browser's own gesture — open in a new tab, a new window, or
 * download — and intercepting those would break behaviour people rely on and that has nothing to do
 * with being offline.
 *
 * @param event - The click.
 * @returns Whether to handle it as an in-app navigation.
 */
function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    event.currentTarget.target !== '_blank'
  );
}
