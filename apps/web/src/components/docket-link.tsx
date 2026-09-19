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
import {
  parseAuthenticatedRoute,
  pathnameOf,
  prefetchAuthenticatedRoute,
} from '@/lib/authenticated-route';
import {
  initiativeDetailAggregateDef,
  programDetailAggregateDef,
  projectDetailAggregateDef,
  taskDetailAggregateDef,
} from '@/lib/detail-aggregate';
import { projectOverviewDef } from '@/lib/fetch-project-overview';
import {
  type NavigationTransition,
  type ResponsiveNavigationOptions,
  type ResponsiveRouter,
  useOptionalResponsiveRouter,
} from '@/lib/interactions/navigation';
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

/**
 * Props for {@link DocketLink}: `next/link`'s, plus how the navigation animates.
 *
 * @remarks
 * `transition="shared-element"` morphs the elements the two pages both name (through their
 * `view-transition-name`) while the rest of the page keeps rendering. It applies to a plain click
 * that the app's own navigation handles; a modified click, a back or forward step, a browser
 * without View Transitions, and a viewer who prefers reduced motion all navigate without it.
 */
export type DocketLinkProps = ComponentProps<typeof Link> & {
  readonly transition?: NavigationTransition;
};

const MODULE_PREFETCH_DELAY_MS = 75;

/** How long a browser without `requestIdleCallback` waits before warming a shared-element link. */
const IDLE_WARM_FALLBACK_MS = 200;

type PrefetchApi = <T>(definition: UseQueryOptions<T, DefaultError, T>) => void;

/** Run `task` once the browser is idle, and return the function that cancels it. */
function runWhenIdle(task: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(task);
    return () => {
      window.cancelIdleCallback(handle);
    };
  }
  const handle = window.setTimeout(task, IDLE_WARM_FALLBACK_MS);
  return () => {
    window.clearTimeout(handle);
  };
}

/** What {@link useDestinationWarming} hands the link's pointer and focus handlers. */
interface DestinationWarming {
  /** Start the delayed warm-up, unless one is already pending. */
  readonly handleIntent: () => void;
  /** Drop a pending warm-up. */
  readonly cancelIntent: () => void;
}

/**
 * Load a link's route module and data ahead of the click.
 *
 * @remarks
 * Pointer and keyboard focus warm the destination after a short delay. A shared-element
 * transition captures its destination in a single commit, which only a loaded module can supply,
 * and a touch or keyboard click gives no hover to warm on, so such a link also warms once when the
 * browser is idle after mount. A failed module load is ignored: the navigation then swaps
 * instantly instead of morphing.
 *
 * @param linkHref - The link's href, or `null` when it is not a string.
 * @param localRoute - Whether the href is an authenticated route of this app; nothing else warms.
 * @param warmOnMount - Whether to warm without waiting for intent.
 */
function useDestinationWarming(
  linkHref: string | null,
  localRoute: boolean,
  warmOnMount: boolean,
): DestinationWarming {
  const href = localRoute ? linkHref : null;
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

  const warmDestination = useCallback((): void => {
    if (href === null) return;
    prefetchAuthenticatedRoute(href).catch(() => undefined);
    prefetchRouteData(href, prefetchApi);
  }, [href, prefetchApi]);

  const handleIntent = useCallback((): void => {
    if (href === null || prefetchTimer.current !== null) return;
    prefetchTimer.current = window.setTimeout(() => {
      prefetchTimer.current = null;
      warmDestination();
    }, MODULE_PREFETCH_DELAY_MS);
  }, [href, warmDestination]);

  useEffect(() => cancelIntent, [cancelIntent]);

  const warmsOnMount = warmOnMount && href !== null;
  useEffect(() => {
    if (!warmsOnMount) return;
    return runWhenIdle(warmDestination);
  }, [warmsOnMount, warmDestination]);

  return { handleIntent, cancelIntent };
}

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
  transition,
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
  const { handleIntent, cancelIntent } = useDestinationWarming(
    href,
    localRoute,
    transition === 'shared-element',
  );

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
      const options: ResponsiveNavigationOptions = { scroll: props.scroll, transition };
      if (requestNavigation(responsiveRouter, href, props.replace, options)) event.preventDefault();
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

/** Publish a push or replace request; true when the app's own navigation took it. */
function requestNavigation(
  router: ResponsiveRouter,
  href: string,
  replace: boolean | undefined,
  options: ResponsiveNavigationOptions | undefined,
): boolean {
  return replace ? router.replace(href, options) : router.push(href, options);
}

/** Warm the query the destination route reads on mount. */
function prefetchRouteData(href: string, prefetch: PrefetchApi): void {
  const match = parseAuthenticatedRoute(pathnameOf(href));
  if (match.kind !== 'matched') return;

  const { params, pattern } = match.route;
  switch (pattern) {
    case '/orgs/[orgId]/tasks/[taskId]':
      prefetch(taskDetailAggregateDef(params.orgId, params.taskId));
      return;
    case '/orgs/[orgId]/projects/[projectId]':
      prefetch(projectDetailAggregateDef(params.orgId, params.projectId));
      return;
    case '/orgs/[orgId]/projects/dependencies':
      prefetch(projectOverviewDef(params.orgId));
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
  return parseAuthenticatedRoute(pathnameOf(href)).kind === 'matched';
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
