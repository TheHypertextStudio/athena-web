/**
 * `@docket/ui` — View Transition support for changing the shell navigation presentation.
 */
import { flushSync } from 'react-dom';

import type { NavigationDestinationId } from './navigation-catalog';

/** The stable shared-element name for the workspace switcher in either navigation presentation. */
export const NAVIGATION_WORKSPACE_TRANSITION_NAME = 'navigation-workspace';

/** Return the stable shared-element name for a primary navigation destination. */
export function navigationDestinationTransitionName(
  destinationId: NavigationDestinationId,
): string {
  return `navigation-${destinationId.replace(':', '-')}`;
}

/** Whether the viewer has asked the application not to animate state changes. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Apply a shell navigation update inside a browser View Transition when it is appropriate.
 *
 * @param update - The React state update that swaps the expanded sidebar and compact rail.
 *
 * @remarks
 * `flushSync` commits the new navigation DOM inside the browser's snapshot callback. The matching
 * elements can then use their stable `view-transition-name` values instead of fading the whole
 * shell. Reduced motion and browsers without the API receive the same state update immediately.
 */
export function startNavigationTransition(update: () => void): void {
  if (
    prefersReducedMotion() ||
    typeof document === 'undefined' ||
    !('startViewTransition' in document)
  ) {
    update();
    return;
  }

  const root = document.documentElement;
  root.dataset['shellNavigationTransition'] = 'true';
  try {
    const transition = document.startViewTransition(() => {
      flushSync(update);
    });
    void transition.finished.finally(() => {
      delete root.dataset['shellNavigationTransition'];
    });
  } catch {
    delete root.dataset['shellNavigationTransition'];
    update();
  }
}
