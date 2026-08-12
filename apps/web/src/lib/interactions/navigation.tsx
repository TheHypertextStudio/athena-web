'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useOptionalInteractionReceipts, type PaintedAcknowledgement } from './receipt-context';

/** Options supported by a responsive in-app navigation request. */
export interface ResponsiveNavigationOptions {
  /** Preserve the current scroll position when Next commits the destination. */
  readonly scroll?: boolean;
}

/** The navigation contract shared by links and imperative owners. */
export interface ResponsiveRouter {
  /** The destination that has been requested but is not yet canonical, or `null` when settled. */
  readonly requestedHref: string | null;
  /** Publish a push navigation and return whether an imperative host accepted the transport. */
  readonly push: (href: string, options?: ResponsiveNavigationOptions) => boolean;
  /** Publish a replacement navigation and return whether an imperative host accepted the transport. */
  readonly replace: (href: string, options?: ResponsiveNavigationOptions) => boolean;
}

/** Props for {@link ResponsiveNavigationProvider}. */
export interface ResponsiveNavigationProviderProps {
  /** Next's canonical pathname and search string for the currently committed route. */
  readonly canonicalHref: string;
  /**
   * Imperative transport supplied by a host that owns navigation directly.
   *
   * @remarks
   * `DocketLink` leaves an unhandled online request to `next/link`, preserving the framework's
   * own transition behavior without requiring this provider to reach for a second router hook.
   */
  readonly navigate?: (
    href: string,
    replace: boolean,
    options?: ResponsiveNavigationOptions,
  ) => void;
  /** The subtree whose links and imperative owners share navigation intent. */
  readonly children: ReactNode;
}

interface NavigationIntent {
  readonly id: number;
  readonly href: string;
  acknowledgement: PaintedAcknowledgement | null;
  readonly invocationId?: string;
}

const ResponsiveNavigationContext = createContext<ResponsiveRouter | null>(null);

/**
 * Publish navigation intent before Next commits the destination route.
 *
 * @remarks
 * The provider deliberately leaves the current location alone while a request is in flight. The
 * existing shell and page therefore remain mounted, while consumers can acknowledge the requested
 * destination without promoting it to the current location. A request settles only after Next's
 * canonical pathname and query string equal the requested href.
 *
 * @param props - The committed route and subtree that share the navigation owner.
 * @returns The responsive navigation context provider.
 */
export function ResponsiveNavigationProvider({
  canonicalHref,
  navigate,
  children,
}: ResponsiveNavigationProviderProps): JSX.Element {
  const router = useRouter();
  const receipts = useOptionalInteractionReceipts();
  const [requestedHref, setRequestedHref] = useState<string | null>(null);
  const intentRef = useRef<NavigationIntent | null>(null);
  const nextIntentId = useRef(0);

  const abandonIntent = useCallback(
    (intent: NavigationIntent): void => {
      intent.acknowledgement?.cancel();
      if (intent.invocationId !== undefined) {
        receipts?.abandonInteraction(intent.invocationId);
      }
    },
    [receipts],
  );

  const supersedeIntent = useCallback(
    (intent: NavigationIntent): void => {
      intent.acknowledgement?.cancel();
      if (intent.invocationId === undefined) return;
      const phase = receipts?.receiptFor(intent.invocationId)?.phase;
      if (phase === 'acknowledged' || phase === 'progressing') {
        receipts?.settleInteraction(intent.invocationId, 'superseded');
      } else {
        receipts?.abandonInteraction(intent.invocationId);
      }
    },
    [receipts],
  );

  const navigateWithRouter = useCallback(
    (href: string, replace: boolean, options?: ResponsiveNavigationOptions): void => {
      const nextOptions = options?.scroll === undefined ? undefined : { scroll: options.scroll };
      if (replace) router.replace(href, nextOptions);
      else router.push(href, nextOptions);
    },
    [router],
  );

  const request = useCallback(
    (href: string, replace: boolean, options?: ResponsiveNavigationOptions): boolean => {
      if (href === canonicalHref) return false;

      const previous = intentRef.current;
      if (previous !== null) supersedeIntent(previous);

      const invocation = receipts?.startInteraction({
        interactionId: 'app.navigation',
        category: 'navigation',
        routeTemplateId: '/',
      });
      const id = ++nextIntentId.current;
      const intent: NavigationIntent = {
        id,
        href,
        acknowledgement: null,
        ...(invocation === undefined ? {} : { invocationId: invocation.invocationId }),
      };
      intentRef.current = intent;
      setRequestedHref(href);

      if (receipts !== null && invocation !== undefined) {
        intent.acknowledgement = receipts.acknowledgeAfterPaint(
          invocation.invocationId,
          () => intentRef.current?.id === id,
        );
      }

      try {
        (navigate ?? navigateWithRouter)(href, replace, options);
        return true;
      } catch {
        if (intentRef.current.id === id) {
          abandonIntent(intent);
          intentRef.current = null;
          setRequestedHref(null);
        }
        return true;
      }
    },
    [abandonIntent, canonicalHref, navigate, navigateWithRouter, receipts, supersedeIntent],
  );

  useEffect(() => {
    const intent = intentRef.current;
    if (intent === null) return;
    if (intent.href !== canonicalHref) {
      intentRef.current = null;
      setRequestedHref(null);
      supersedeIntent(intent);
      return;
    }

    intentRef.current = null;
    setRequestedHref(null);
    if (intent.invocationId === undefined || intent.acknowledgement === null || receipts === null) {
      return;
    }
    const { invocationId } = intent;

    void intent.acknowledgement.done.then((receipt) => {
      if (receipt?.phase === 'acknowledged') {
        receipts.settleInteraction(invocationId, 'succeeded');
      }
    });
  }, [canonicalHref, receipts, supersedeIntent]);

  useEffect(
    () => () => {
      const intent = intentRef.current;
      if (intent !== null) abandonIntent(intent);
    },
    [abandonIntent],
  );

  const value = useMemo<ResponsiveRouter>(
    () => ({
      requestedHref,
      push: (href, options) => {
        return request(href, false, options);
      },
      replace: (href, options) => {
        return request(href, true, options);
      },
    }),
    [request, requestedHref],
  );

  return (
    <ResponsiveNavigationContext.Provider value={value}>
      {children}
    </ResponsiveNavigationContext.Provider>
  );
}

/**
 * Read the responsive navigation contract.
 *
 * @returns The current navigation owner.
 * @throws {Error} When no responsive navigation provider is mounted.
 */
export function useResponsiveRouter(): ResponsiveRouter {
  const router = useOptionalResponsiveRouter();
  if (router === null) {
    throw new Error('ResponsiveNavigationProvider is not mounted above this component.');
  }
  return router;
}

/**
 * Read navigation intent where links may also render outside the authenticated application shell.
 *
 * @returns The current navigation owner, or `null` when ordinary `next/link` behavior is required.
 */
export function useOptionalResponsiveRouter(): ResponsiveRouter | null {
  return useContext(ResponsiveNavigationContext);
}

/**
 * Navigate through the responsive seam when one is mounted, and through Next's router otherwise.
 *
 * @returns A router whose `push`/`replace` publish navigation intent where that is possible.
 *
 * @remarks
 * For components that navigate but do not belong to the app shell — the create composers, say.
 * Inside the shell they get intent publication, which is what lets a click be acknowledged before
 * the route payload arrives. Rendered anywhere else — a focused test, a surface outside the
 * authenticated shell — they still navigate, rather than refusing to render because a piece of
 * chrome they never asked for is absent.
 */
export function useAppRouter(): ResponsiveRouter {
  const responsive = useOptionalResponsiveRouter();
  const router = useRouter();
  const fallback = useMemo<ResponsiveRouter>(
    () => ({
      requestedHref: null,
      // Called with one argument when there are no options, matching what a direct
      // `router.push(href)` looks like — a trailing `undefined` is not the same call.
      push: (href, options) => {
        if (options?.scroll === undefined) router.push(href);
        else router.push(href, { scroll: options.scroll });
        return true;
      },
      replace: (href, options) => {
        if (options?.scroll === undefined) router.replace(href);
        else router.replace(href, { scroll: options.scroll });
        return true;
      },
    }),
    [router],
  );
  return responsive ?? fallback;
}
