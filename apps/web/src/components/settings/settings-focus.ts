'use client';

/** Scroll to and focus the stable Settings heading named by the current route fragment. */
export function focusSettingsHashTarget(): boolean {
  if (!window.location.hash) return false;
  const id = decodeURIComponent(window.location.hash.slice(1));
  const destination = document.getElementById(id);
  if (!(destination instanceof HTMLElement)) return false;
  destination.scrollIntoView({ block: 'start' });
  destination.focus({ preventScroll: true });
  return document.activeElement === destination;
}
