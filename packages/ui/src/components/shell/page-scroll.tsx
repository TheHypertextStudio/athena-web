'use client';

/**
 * `shell/page-scroll` — which box scrolls: the shell's `<main>`, or the page inside it.
 *
 * @remarks
 * `<main>` is the shell's one scroll container, and that is the right default: a page writes
 * ordinary top-to-bottom content and the shell handles the rest.
 *
 * Two things are impossible under that default. A page cannot draw to `<main>`'s right edge,
 * because `scrollbar-gutter: stable` permanently reserves the scrollbar's width *inside* the
 * padding box — measured at 11px on this platform — so a full-width child always stops short of
 * the edge. And a page cannot pin a header, because the header scrolls away with everything else
 * in the same box.
 *
 * A page that wants either one takes ownership of scrolling by calling {@link useOwnPageScroll}.
 * `<main>` then stops scrolling and stops reserving a gutter, and the page fills it exactly and
 * scrolls whatever region it chooses.
 *
 * Ownership is declared by the page rather than derived from its route. A path list in the shell
 * would put the decision in the file furthest from the page making it, and would be wrong the
 * first time a route moved.
 */
import * as React from 'react';

/** Whether the shell's `<main>` scrolls, or the page inside it does. */
export type PageScrollOwner = 'shell' | 'page';

/** The shell-owned scroll-ownership state. */
interface PageScrollContextValue {
  readonly owner: PageScrollOwner;
  readonly setOwner: (owner: PageScrollOwner) => void;
}

const PageScrollContext = React.createContext<PageScrollContextValue | null>(null);

/** Props for {@link PageScrollProvider}. */
export interface PageScrollProviderProps {
  children: React.ReactNode;
}

/**
 * Hold which box scrolls, for the shell to read and a page to set.
 *
 * @param props - The {@link PageScrollProviderProps}.
 * @returns The provider.
 */
export function PageScrollProvider({ children }: PageScrollProviderProps): React.JSX.Element {
  const [owner, setOwner] = React.useState<PageScrollOwner>('shell');
  const value = React.useMemo<PageScrollContextValue>(() => ({ owner, setOwner }), [owner]);
  return <PageScrollContext.Provider value={value}>{children}</PageScrollContext.Provider>;
}

/**
 * Read the current scroll owner. Defaults to `shell` when no provider is mounted.
 *
 * @returns The owner.
 */
export function usePageScrollOwner(): PageScrollOwner {
  return React.useContext(PageScrollContext)?.owner ?? 'shell';
}

/**
 * Declare that this page scrolls itself, for as long as it is mounted.
 *
 * @remarks
 * Reverts to `shell` on unmount, so a page that forgets to release it cannot leave the next route
 * unable to scroll. Call it unconditionally and pass `enabled`, rather than calling it
 * conditionally — a layout whose shape depends on a prop still has to run the same hooks.
 *
 * @param enabled - Whether this page owns scrolling. Defaults to true.
 *
 * @example
 * ```tsx
 * export default function TeamDetailClient(): JSX.Element {
 *   useOwnPageScroll();
 *   // …the page fills `<main>` and scrolls its own panel.
 * }
 * ```
 */
export function useOwnPageScroll(enabled = true): void {
  const ctx = React.useContext(PageScrollContext);
  const setOwner = ctx?.setOwner;
  React.useEffect(() => {
    if (!setOwner || !enabled) return;
    setOwner('page');
    return () => {
      setOwner('shell');
    };
  }, [enabled, setOwner]);
}
