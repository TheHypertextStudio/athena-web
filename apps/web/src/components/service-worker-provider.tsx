'use client';

import { Button } from '@docket/ui/primitives';
import {
  type JSX,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/**
 * Registers the service worker and publishes the "a new version is ready" handshake.
 *
 * @remarks
 * Mounted at the **root**, not inside the authenticated shell, so registration happens on every
 * route. Someone arriving at `/sign-in` or a marketing page is exactly who needs the worker
 * installed early — offline support must be bootstrapped before it is needed, and an app that only
 * registered after sign-in would never cache its offline page for a first-run install.
 *
 * The update state is published through context rather than rendered here, so the shell can place
 * {@link UpdateBanner} in its one banner slot and order it against the offline notice, instead of
 * two independent banners stacking.
 *
 * The worker installs and then **waits**: `sw.ts` deliberately omits `skipWaiting()` on install, so
 * a new version never takes over a live tab and mixes old chunks with new ones mid-session. The
 * exchange is explicit — the worker waits, this notices, someone accepts, and only then does it
 * activate and the page reload.
 *
 * Registration failures are swallowed on purpose: they are not user-actionable, there is no toast
 * system in this codebase, and reading `.message` off the resulting `DOMException` is a hard
 * violation of the repository's error-source policy. A failed registration costs offline support
 * and nothing else.
 */

/**
 * The DOM lib types `navigator.serviceWorker` as always present. Browsers disagree, so the property
 * is re-declared as optional and read through this shape.
 */
interface MaybeWorkerHost {
  readonly serviceWorker?: ServiceWorkerContainer;
}

/** How long to wait between update checks triggered by the tab regaining focus. */
const UPDATE_CHECK_THROTTLE_MS = 60_000;

/**
 * How long an accepted update gets to activate and claim the page before the tab reloads anyway.
 * Activation is normally near-instant; this only fires when the handshake breaks (a missed
 * `controllerchange`, activation stalled in the worker), where reloading on the old worker still
 * beats a Reload button that visibly does nothing.
 */
const APPLY_FALLBACK_MS = 4_000;

/** Published service-worker state. */
interface ServiceWorkerValue {
  /** Applies the waiting update and reloads, or `null` when no update is waiting. */
  readonly applyUpdate: (() => void) | null;
}

const ServiceWorkerContext = createContext<ServiceWorkerValue>({ applyUpdate: null });

/** Read the current service-worker update state. */
export function useServiceWorkerUpdate(): ServiceWorkerValue {
  return useContext(ServiceWorkerContext);
}

/** Registers the worker and publishes update state to the tree. */
export function ServiceWorkerProvider({ children }: { children: ReactNode }): JSX.Element {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const reloadingRef = useRef(false);
  const lastCheckRef = useRef(0);

  useEffect(() => {
    // A truthiness check, not `'serviceWorker' in navigator`. The `in` form is true whenever the
    // property merely *exists*, which is not the same as it being usable — and the difference is
    // not hypothetical: with the property present but undefined, this effect used to reach
    // `navigator.serviceWorker.addEventListener` below and throw a TypeError out of the root
    // provider, taking the whole application down over an enhancement it can live without. Caught
    // by e2e/platform/pwa-progressive-enhancement.spec.ts.
    const container = (navigator as unknown as MaybeWorkerHost).serviceWorker;
    if (!container) return undefined;

    let registration: ServiceWorkerRegistration | undefined;
    let disposed = false;
    const offeredListeners: [ServiceWorker, () => void][] = [];

    // Prompt only when an existing worker is being replaced. On a first visit a worker also
    // reaches `installed`, but nothing on screen is stale — asking someone to reload a page they
    // just opened would be noise.
    const offerIfStale = (worker: ServiceWorker | null): void => {
      if (disposed || !worker || !container.controller) {
        return;
      }
      // An offered worker can go redundant before anyone clicks Reload — superseded by a newer
      // install during a rolling deploy, or activated from another tab (where controllerchange
      // handles the reload). Withdraw the offer then, or the banner outlives the worker it
      // promises to activate and the button goes dead.
      const onStateChange = (): void => {
        if (worker.state === 'redundant') {
          setWaiting((current) => (current === worker ? null : current));
        }
      };
      worker.addEventListener('statechange', onStateChange);
      offeredListeners.push([worker, onStateChange]);
      setWaiting(worker);
    };

    const onControllerChange = (): void => {
      // Guarded: this can fire more than once, and a reload loop would be catastrophic.
      if (reloadingRef.current) return;
      reloadingRef.current = true;
      window.location.reload();
    };

    const onUpdateFound = (): void => {
      const installing = registration?.installing;
      if (!installing) {
        return;
      }
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed') {
          offerIfStale(installing);
        }
      });
    };

    const register = async (): Promise<void> => {
      try {
        registration = await container.register('/sw.js');
        if (disposed) {
          return;
        }

        // A worker may already be waiting from an earlier visit that was never reloaded.
        offerIfStale(registration.waiting);

        registration.addEventListener('updatefound', onUpdateFound);
      } catch {
        // See the note above: not user-actionable, and the error object must not be read.
      }
    };

    const onVisibility = (): void => {
      if (document.visibilityState !== 'visible' || !registration) return;
      const now = Date.now();
      if (now - lastCheckRef.current < UPDATE_CHECK_THROTTLE_MS) return;
      lastCheckRef.current = now;
      void registration.update();
    };

    const onLoad = (): void => {
      void register();
    };

    // Registering after `load` keeps the install off the critical path of the first paint.
    if (document.readyState === 'complete') {
      void register();
    } else {
      window.addEventListener('load', onLoad, { once: true });
    }

    container.addEventListener('controllerchange', onControllerChange);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      container.removeEventListener('controllerchange', onControllerChange);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('load', onLoad);
      registration?.removeEventListener('updatefound', onUpdateFound);
      for (const [worker, listener] of offeredListeners) {
        worker.removeEventListener('statechange', listener);
      }
    };
  }, []);

  const applyUpdate = useCallback((): void => {
    if (!waiting) {
      return;
    }
    if (waiting.state === 'redundant') {
      // A deploy raced the click: this worker was superseded before it could activate. The
      // statechange withdrawal normally clears the banner first; this is the belt for the race
      // where the click lands in between.
      setWaiting(null);
      return;
    }
    // `type`, never `message`: the error-source policy's AST scan flags any property named
    // `message` under `src/`, and the worker matches on `type` accordingly.
    waiting.postMessage({ type: 'SKIP_WAITING' });
    // No optimistic dismissal: the banner clears by the page reloading (controllerchange), so a
    // failed handshake can never silently swallow the prompt. If activation stalls, force the
    // reload — see APPLY_FALLBACK_MS.
    window.setTimeout(() => {
      if (!reloadingRef.current) {
        reloadingRef.current = true;
        window.location.reload();
      }
    }, APPLY_FALLBACK_MS);
  }, [waiting]);

  const value = useMemo<ServiceWorkerValue>(
    () => ({ applyUpdate: waiting ? applyUpdate : null }),
    [waiting, applyUpdate],
  );

  return <ServiceWorkerContext value={value}>{children}</ServiceWorkerContext>;
}

/** The inline "new version ready" prompt, rendered by the shell in its banner slot. */
export function UpdateBanner({ onApply }: { readonly onApply: () => void }): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className="border-outline-variant bg-surface-container-high text-on-surface text-body-medium flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2"
    >
      <span className="text-label-large min-w-0 flex-1 truncate">Update ready</span>
      <Button variant="outline" size="sm" onClick={onApply}>
        Reload
      </Button>
    </div>
  );
}
