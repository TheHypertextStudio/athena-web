'use client';

const FOCUS_PARAM = 'route-focus';
const ROUTE_SETTLE_FOCUS_MS = 50;

function focusHint(): string | null {
  const id = new URLSearchParams(window.location.search).get(FOCUS_PARAM);
  return id?.trim() ? id : null;
}

/** Add a transient query hint so a cross-document destination receives its fragment target. */
export function withRouteFragmentFocusHint(href: string): string {
  const destination = new URL(href, window.location.origin);
  if (!destination.hash) return href;
  destination.searchParams.set(FOCUS_PARAM, decodeURIComponent(destination.hash.slice(1)));
  return `${destination.pathname}${destination.search}${destination.hash}`;
}

/** Return whether the current document carries a transient anchor focus hint. */
export function hasPendingRouteFragmentFocus(): boolean {
  return focusHint() !== null;
}

/** Focus the hinted anchor and replace the transient query with its public route fragment. */
export function focusPendingRouteFragment(): boolean {
  const id = focusHint();
  if (!id) return false;
  const destination = document.getElementById(id);
  if (!(destination instanceof HTMLElement)) return false;
  destination.scrollIntoView({ block: 'start' });
  destination.focus({ preventScroll: true });
  if (document.activeElement !== destination) return false;

  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete(FOCUS_PARAM);
  cleanUrl.hash = `#${encodeURIComponent(id)}`;
  window.history.replaceState(
    window.history.state,
    '',
    `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`,
  );
  // Next observes the native history update and can remount the dialog once while removing the
  // transient query. Refocus after that handoff so its second initial-focus pass cannot win.
  setTimeout(() => {
    const settledDestination = document.getElementById(id);
    if (!(settledDestination instanceof HTMLElement)) return;
    settledDestination.scrollIntoView({ block: 'start' });
    settledDestination.focus({ preventScroll: true });
  }, ROUTE_SETTLE_FOCUS_MS);
  return true;
}
