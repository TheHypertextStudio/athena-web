'use client';

import { cn } from '@docket/ui/lib/utils';
import Link from 'next/link';
import type { ComponentProps, JSX, MouseEvent } from 'react';

import { useServerReachable } from '@/components/reachability';
import { navigateWithoutRouter } from '@/lib/app-location';
import { useOfflineAvailability } from '@/lib/offline-availability';

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
 * Reachability comes from the shell's own session state, not `navigator.onLine` — see
 * {@link file://./reachability.tsx} for why that distinction is load-bearing rather than pedantic.
 *
 * Only plain left clicks are intercepted. A modified click (new tab, new window, download) is the
 * browser's business and is left alone, exactly as `next/link` leaves it alone.
 */

/** Props for {@link DocketLink}: `next/link`'s, unchanged. */
export type DocketLinkProps = ComponentProps<typeof Link>;

/**
 * Navigate without losing the shell when there is no server to ask.
 *
 * @param props - `next/link`'s props.
 * @returns The link.
 */
export default function DocketLink({ onClick, ...props }: DocketLinkProps): JSX.Element {
  const reachable = useServerReachable();
  const href = typeof props.href === 'string' ? props.href : null;
  const availability = useOfflineAvailability(href, !reachable);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (reachable || event.defaultPrevented) {
      return;
    }
    if (!isPlainLeftClick(event)) {
      return;
    }
    if (href?.startsWith('/') !== true) {
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

  return <Link {...props} onClick={handleClick} />;
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
