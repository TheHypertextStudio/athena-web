'use client';

import { ArrowRight, CircleAlert, Sparkles } from '@docket/ui/icons';
import { focusRing } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
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

import { NAVIGATION_PROGRESS_SWEEP_CLASSNAME } from '@/components/navigation-progress';

/**
 * Registers the service worker and publishes the "a new version is ready" handshake.
 *
 * @remarks
 * Mounted at the **root**, not inside the authenticated shell, so registration happens on every
 * route. Someone arriving at `/sign-in` or a marketing page is exactly who needs the worker
 * installed early — offline support must be bootstrapped before it is needed, and an app that only
 * registered after sign-in would never cache its offline page for a first-run install.
 *
 * The update state is published through context rather than rendered here, so the shell can dock
 * {@link UpdateCard} at the bottom of its sidebar — out of the content column entirely, where an
 * update prompt can wait without competing with the offline notice or the work on screen.
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

/** How long to leave the final visible acknowledgement before the hard reload fallback. */
const RELOADING_NOTICE_MS = 250;

/** The visible lifecycle of one offered service-worker update. */
type UpdatePhase = 'ready' | 'applying' | 'reloading' | 'failed';

/** Published service-worker state. */
interface ServiceWorkerValue {
  /** Applies the waiting update and reloads, or `null` when no update is waiting. */
  readonly applyUpdate: (() => void) | null;
  /** The visible phase of the offered update, or `null` without an active offer. */
  readonly updatePhase: UpdatePhase | null;
}

const ServiceWorkerContext = createContext<ServiceWorkerValue>({
  applyUpdate: null,
  updatePhase: null,
});

/** Read the current service-worker update state. */
export function useServiceWorkerUpdate(): ServiceWorkerValue {
  return useContext(ServiceWorkerContext);
}

/** Registers the worker and publishes update state to the tree. */
export function ServiceWorkerProvider({ children }: { children: ReactNode }): JSX.Element {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase | null>(null);
  const reloadingRef = useRef(false);
  const lastCheckRef = useRef(0);
  const waitingRef = useRef<ServiceWorker | null>(null);
  const updatePhaseRef = useRef<UpdatePhase | null>(null);

  const setPhase = useCallback((phase: UpdatePhase | null): void => {
    updatePhaseRef.current = phase;
    setUpdatePhase(phase);
  }, []);

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
      // handles the reload). Preserve an application-owned recovery card instead of letting the
      // primary action disappear without explaining why it can no longer start.
      const onStateChange = (): void => {
        if (worker.state !== 'redundant' || waitingRef.current !== worker) return;
        waitingRef.current = null;
        setWaiting(null);
        setPhase('failed');
      };
      worker.addEventListener('statechange', onStateChange);
      offeredListeners.push([worker, onStateChange]);
      waitingRef.current = worker;
      setWaiting(worker);
      setPhase('ready');
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
  }, [setPhase]);

  const applyUpdate = useCallback((): void => {
    if (updatePhaseRef.current === 'applying' || updatePhaseRef.current === 'reloading') {
      return;
    }
    if (!waiting) {
      setPhase('failed');
      return;
    }
    if (waiting.state === 'redundant') {
      // A deploy raced the click: this worker was superseded before it could activate. The
      // statechange recovery normally reaches the card first; this is the belt for the race where
      // the click lands in between.
      waitingRef.current = null;
      setWaiting(null);
      setPhase('failed');
      return;
    }
    setPhase('applying');
    // `type`, never `message`: the error-source policy's AST scan flags any property named
    // `message` under `src/`, and the worker matches on `type` accordingly.
    try {
      waiting.postMessage({ type: 'SKIP_WAITING' });
    } catch {
      // The worker can become unusable between offering and the click. The card provides the
      // application-owned recovery instead of surfacing browser-specific exception text.
      setPhase('failed');
      return;
    }
    // No optimistic dismissal: the banner clears by the page reloading (controllerchange), so a
    // failed handshake can never silently swallow the prompt. If activation stalls, force the
    // reload — see APPLY_FALLBACK_MS.
    window.setTimeout(() => {
      if (!reloadingRef.current) {
        setPhase('reloading');
      }
    }, APPLY_FALLBACK_MS - RELOADING_NOTICE_MS);
    window.setTimeout(() => {
      if (!reloadingRef.current) {
        reloadingRef.current = true;
        window.location.reload();
      }
    }, APPLY_FALLBACK_MS);
  }, [setPhase, waiting]);

  const value = useMemo<ServiceWorkerValue>(
    () => ({
      applyUpdate: waiting || updatePhase === 'failed' ? applyUpdate : null,
      updatePhase: waiting || updatePhase === 'failed' ? updatePhase : null,
    }),
    [waiting, updatePhase, applyUpdate],
  );

  return <ServiceWorkerContext value={value}>{children}</ServiceWorkerContext>;
}

/**
 * The "new version ready" prompt: a card docked at the bottom of the sidebar, above the account
 * row. Its visual state is intentionally separate from the worker handshake: the card makes a
 * completed click legible while the worker still owns activation and page takeover.
 *
 * Each phase renders exactly one message. Idle/ready and failure are distinguished by a leading
 * icon (a sparkle, or an alert glyph in `text-error`); the in-flight phases show an indeterminate
 * progress bar instead — the handshake reports no real progress, so a bar that filled to a
 * percentage would be inventing one (same reasoning as {@link NavigationProgress}, whose
 * `navigation-progress` keyframe this reuses). The reloading phase is the one moment with a real
 * signal — the forced reload fallback is seconds away — so its bar fills to completion instead of
 * continuing to sweep.
 *
 * The applying and reloading phases render no button — there is nothing to click while the worker
 * is mid-handshake, so showing a disabled control there previously read as a duplicated message.
 */
export function UpdateCard({ onApply }: { readonly onApply: () => void }): JSX.Element {
  const { updatePhase } = useServiceWorkerUpdate();
  const phase = updatePhase ?? 'ready';
  const isApplying = phase === 'applying';
  const isReloading = phase === 'reloading';
  const isFailed = phase === 'failed';
  const isBusy = isApplying || isReloading;
  const containerRef = useRef<HTMLDivElement>(null);

  // The busy phases render no button (see below), so a click/keyboard-activation that starts the
  // handshake takes its own focused element out of the DOM. Move focus to the card itself so a
  // keyboard or screen-reader user isn't dropped to `<body>`.
  useEffect(() => {
    if (isBusy) containerRef.current?.focus();
  }, [isBusy]);

  const Icon = isFailed ? CircleAlert : Sparkles;
  const iconColor = isFailed ? 'text-error' : 'text-primary';
  const actionLabel = isFailed ? 'Retry' : 'Reload now';
  const busyMessage = isApplying ? 'Applying update…' : 'Reloading…';
  const readyOrFailedMessage = isFailed ? 'Couldn’t apply update' : 'Update available';

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="status"
      aria-live="polite"
      aria-busy={isBusy ? 'true' : undefined}
      className={cn(
        'bg-secondary-container text-on-secondary-container shadow-level1 rounded-lg px-3 py-2.5',
        focusRing,
      )}
    >
      {isBusy ? (
        <div>
          <p className="text-label-large truncate">{busyMessage}</p>
          <div
            role={isReloading ? 'progressbar' : undefined}
            aria-hidden={isReloading ? undefined : true}
            aria-valuenow={isReloading ? 100 : undefined}
            aria-valuemin={isReloading ? 0 : undefined}
            aria-valuemax={isReloading ? 100 : undefined}
            aria-label={isReloading ? 'Reloading' : undefined}
            className="bg-on-secondary-container/12 mt-2 h-1 w-full overflow-hidden rounded-full"
          >
            <div
              className={cn(
                'bg-primary h-full rounded-full',
                isReloading
                  ? 'w-full transition-[width] duration-200 ease-out'
                  : NAVIGATION_PROGRESS_SWEEP_CLASSNAME,
              )}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-2">
            <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', iconColor)} />
            <div className="min-w-0 flex-1">
              <p className="text-label-large">{readyOrFailedMessage}</p>
              {!isFailed && (
                <p className="text-body-small mt-0.5">Reload to use the latest version</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onApply}
            className={cn(
              'group text-label-large hover:bg-on-secondary-container/8 mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 transition-colors',
              focusRing,
            )}
          >
            <span className="min-w-0 flex-1 truncate text-left">{actionLabel}</span>
            <ArrowRight
              aria-hidden="true"
              className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
            />
          </button>
        </>
      )}
    </div>
  );
}
