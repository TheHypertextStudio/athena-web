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
 * are "possible, even if not perfect". A transition the browser skips, because the next one started
 * before it finished, settles its promises by rejecting; those rejections are observed here so a
 * quick pair of updates never surfaces as an unhandled error.
 */
import { flushSync } from 'react-dom';

/** A rejection of a skipped transition is expected and carries nothing to act on. */
function settle(promise: Promise<unknown>): void {
  promise.catch(() => undefined);
}

/**
 * Apply `update` inside a browser View Transition, or at once where the API is unsupported.
 *
 * @param update - The state change; runs synchronously so the browser captures the new state.
 */
export function startViewTransition(update: () => void): void {
  // `in` is a runtime feature-detect: the type exists in the DOM lib, but the method is absent in
  // older browsers (Firefox), where we fall through to an instant update.
  if (typeof document !== 'undefined' && 'startViewTransition' in document) {
    const transition = document.startViewTransition(() => {
      flushSync(update);
    });
    settle(transition.ready);
    settle(transition.finished);
    return;
  }
  update();
}
