'use client';

/**
 * `@docket/ui/hooks` — an SSR-safe media-query match hook.
 *
 * @remarks
 * Used where a layout decision cannot be made in CSS alone — e.g. the {@link AppShell} drives both
 * an inline desktop rail and a modal mobile {@link Sheet} from a *single* open-state, and a Radix
 * Sheet's overlay/scroll-lock/focus-trap must not activate on desktop even when CSS-hidden. A JS
 * breakpoint signal lets the shell mount exactly one of the two.
 *
 * Built on {@link React.useSyncExternalStore} so the value is correct on the first client commit:
 * the server snapshot is always `false`, and the real match lands immediately after hydration with
 * no warning and no flash.
 */
import * as React from 'react';

/**
 * Whether the given media query currently matches.
 *
 * @param query - A CSS media-query string, e.g. `'(min-width: 64rem)'`.
 * @returns `true` when the query matches; always `false` during SSR.
 *
 * @example
 * ```tsx
 * const isLgUp = useMediaQuery('(min-width: 64rem)');
 * ```
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void): (() => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => {
        mql.removeEventListener('change', onChange);
      };
    },
    [query],
  );

  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
