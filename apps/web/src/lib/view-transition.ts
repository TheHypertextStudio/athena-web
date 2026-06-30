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
 * Where the API is unsupported the update still happens, just instantly — shared-element transitions
 * are "possible, even if not perfect".
 */
import { flushSync } from 'react-dom';

/** Apply `update` inside a View Transition when supported, else apply it immediately. */
export function startViewTransition(update: () => void): void {
  // `in` is a runtime feature-detect: the type exists in the DOM lib, but the method is absent in
  // older browsers (Firefox), where we fall through to an instant update.
  if (typeof document !== 'undefined' && 'startViewTransition' in document) {
    document.startViewTransition(() => {
      flushSync(update);
    });
    return;
  }
  update();
}
