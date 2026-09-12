'use client';

/**
 * `@docket/ui` — which input device the reader is currently driving.
 *
 * @remarks
 * This is `:focus-visible`'s heuristic, made available to code. The browser already runs it for
 * real DOM focus, and nothing here should be used where `:focus-visible` reaches — a button, a
 * link, a menu row that actually holds focus. It exists for the one shape the pseudo-class cannot
 * see: a listbox that keeps focus on a search input or a text editor and names its highlighted row
 * with `aria-activedescendant`. That row has no focus to be visible, so it has to ask.
 *
 * The distinction matters because a pointer moving across a menu still moves the highlight — that
 * is how one cursor serves both devices — and a focus indicator that follows the mouse is the
 * result. A ring is a keyboard affordance. Hover is a state layer.
 *
 * The listeners are shared by every subscriber, since a long menu mounts a row per option and each
 * would otherwise attach its own.
 *
 * `keydown` and `pointerdown` stay attached for the page's life, because the gesture that decides
 * how a menu should open happens *before* it mounts: the click on a trigger fires while nothing is
 * subscribed, and a hook that starts listening afterwards would report whatever modality was left
 * over — opening a mouse-clicked picker with a keyboard ring on its current row, which is the whole
 * defect this exists to prevent. They are discrete and cheap. `pointermove` is neither, so it is
 * attached only while something is actually watching.
 */
import * as React from 'react';

/** Which device last drove the interface. */
export type InputModality = 'keyboard' | 'pointer';

let current: InputModality = 'pointer';
const subscribers = new Set<() => void>();
let listening = false;
let trackingMoves = false;

/** Publish a change to every mounted subscriber, skipping no-op transitions. */
function set(next: InputModality): void {
  if (current === next) return;
  current = next;
  for (const notify of subscribers) notify();
}

/** The keys that are only ever half of a chord, and say nothing on their own. */
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

function onKeyDown(event: KeyboardEvent): void {
  // Holding a modifier down is not yet navigating, and it fires repeatedly while held. A chord
  // that has reached a real key is keyboard input like any other: someone pasting a query with
  // Cmd+V is driving the keyboard, and the row Enter would take has to show it.
  if (MODIFIER_KEYS.has(event.key)) return;
  set('keyboard');
}

function onPointer(): void {
  set('pointer');
}

/**
 * Attach the discrete listeners once, for good.
 *
 * Capture phase throughout, so a handler that stops propagation cannot leave the modality stale.
 */
function startListening(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('pointerdown', onPointer, true);
}

/** Track `pointermove` only while something is watching; it fires continuously. */
function setMoveTracking(active: boolean): void {
  if (typeof document === 'undefined' || active === trackingMoves) return;
  trackingMoves = active;
  if (active) document.addEventListener('pointermove', onPointer, true);
  else document.removeEventListener('pointermove', onPointer, true);
}

function subscribe(notify: () => void): () => void {
  startListening();
  subscribers.add(notify);
  setMoveTracking(true);
  return () => {
    subscribers.delete(notify);
    if (subscribers.size === 0) setMoveTracking(false);
  };
}

function getSnapshot(): InputModality {
  return current;
}

/**
 * Report which device the reader is currently driving.
 *
 * @returns `'keyboard'` after a key press, `'pointer'` after mouse or touch movement.
 *
 * @remarks
 * Server-renders as `'pointer'`, so a row never arrives from the server already ringed.
 *
 * @example
 * ```tsx
 * const modality = useInputModality();
 * <li data-nav={active ? modality : undefined} className={menuActiveDescendantRing} />
 * ```
 */
export function useInputModality(): InputModality {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => 'pointer' as const);
}
