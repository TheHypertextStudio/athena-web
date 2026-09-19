/**
 * `lib/view-transition` — run a state change inside a browser View Transition.
 *
 * @remarks
 * The app's rule is to transition between UI states, never hard-swap. Wrapping a React state update
 * in `document.startViewTransition` lets the browser morph the DOM between snapshots — shared
 * elements that carry a `view-transition-name` slide/scale from their old box to their new one (e.g.
 * an agenda entry from a list row to a timeline block). `flushSync` makes the update land
 * synchronously inside the transition callback so the browser captures the new state.
 *
 * Two scopes are available. The default `root` scope cross-fades the whole document alongside any
 * named elements. The `named` scope marks `<html>` with `data-view-transition-scope="named"` for
 * the transition's lifetime; `globals.css` removes the root's own transition name under that flag,
 * so only elements carrying a stable `view-transition-name` animate and the rest of the page keeps
 * rendering and taking input. Both scopes honour `prefers-reduced-motion` by applying the update at
 * once, the same contract the shell navigation transition keeps.
 *
 * Where the API is unsupported the update still happens, just instantly — shared-element transitions
 * are "possible, even if not perfect". A transition the browser skips, because the next one started
 * before it finished, settles its promises by rejecting; those rejections are observed here so a
 * quick pair of updates never surfaces as an unhandled error.
 */
import type { CSSProperties } from 'react';
import { flushSync } from 'react-dom';

import { prefersReducedMotion } from '@/lib/motion';

/**
 * The inline style that gives an element a stable `view-transition-name`.
 *
 * @param name - The name, or `undefined` for an element that takes no part in the transition.
 * @returns the style to spread onto the element, or `undefined` when there is no name.
 */
export function transitionNameStyle(name: string | undefined): CSSProperties | undefined {
  return name === undefined ? undefined : { viewTransitionName: name };
}

/** How much of the document a View Transition captures. */
export interface ViewTransitionOptions {
  /** `root` (default) snapshots the whole page; `named` animates only named elements. */
  readonly scope?: 'root' | 'named';
}

/** A rejection of a skipped transition is expected and carries nothing to act on. */
function settle(promise: Promise<unknown>): void {
  promise.catch(() => undefined);
}

/** Whether the document can start a View Transition at all. */
function supportsViewTransitions(): boolean {
  // `in` is a runtime feature-detect: the type exists in the DOM lib, but the method is absent in
  // older browsers (Firefox), where we fall through to an instant update.
  return typeof document !== 'undefined' && 'startViewTransition' in document;
}

/** Counts named transitions so only the newest one clears the document's scope flag. */
let namedGeneration = 0;

function startNamedViewTransition(update: () => void): void {
  const root = document.documentElement;
  namedGeneration += 1;
  const generation = namedGeneration;
  root.dataset['viewTransitionScope'] = 'named';
  // A newer named transition owns the flag once it starts; the skipped one settles afterwards.
  const clear = (): void => {
    if (generation === namedGeneration) delete root.dataset['viewTransitionScope'];
  };
  try {
    const transition = document.startViewTransition(() => {
      flushSync(update);
    });
    settle(transition.ready);
    // A skipped transition rejects `finished`; that is routine, so clear the flag on both paths.
    void transition.finished.then(clear, clear);
  } catch {
    clear();
    update();
  }
}

/**
 * Apply `update` inside a browser View Transition, or at once where the API is unsupported.
 *
 * @param update - The state change; runs synchronously so the browser captures the new state.
 * @param options - The capture scope; see {@link ViewTransitionOptions}.
 */
export function startViewTransition(update: () => void, options: ViewTransitionOptions = {}): void {
  if (!supportsViewTransitions() || prefersReducedMotion()) {
    update();
    return;
  }
  if (options.scope === 'named') {
    startNamedViewTransition(update);
    return;
  }
  const transition = document.startViewTransition(() => {
    flushSync(update);
  });
  settle(transition.ready);
  settle(transition.finished);
}
