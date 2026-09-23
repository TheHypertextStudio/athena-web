/**
 * A pending request to open one entity's origin card.
 *
 * @remarks
 * The Show origin action runs from the palette, the right-click menu, or a list row, none of which
 * hold the card. It leaves a request here and, when it was invoked away from the entity's page,
 * navigates there. The entity's Created row subscribes, opens its card, and consumes the request.
 * A module-level store rather than React state because the request has to outlive the navigation
 * between the list that asked and the page that answers.
 */

/** The entity whose origin card should open. */
export interface OriginRequestTarget {
  readonly kind: string;
  readonly id: string;
}

/** A request, stamped with when it was made. */
export interface OriginRequest extends OriginRequestTarget {
  readonly requestedAt: number;
}

/** How long a request waits for its Created row: long enough for a navigation and a load. */
export const ORIGIN_REQUEST_TTL_MS = 15_000;

let current: OriginRequest | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Ask the entity's Created row to open its origin card.
 *
 * @param target - The entity.
 * @param now - The current time, for tests.
 */
export function requestOrigin(target: OriginRequestTarget, now: number = Date.now()): void {
  current = { kind: target.kind, id: target.id, requestedAt: now };
  notify();
}

/**
 * Subscribe to request changes.
 *
 * @param listener - Called whenever a request is made or consumed.
 * @returns the unsubscribe function.
 */
export function subscribeOriginRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** @returns the pending request, or null. */
export function readOriginRequest(): OriginRequest | null {
  return current;
}

/**
 * Whether a request is for this entity and still fresh.
 *
 * @param request - The pending request.
 * @param target - The entity a Created row shows.
 * @param now - The current time, for tests.
 * @returns true when the row should answer it.
 */
export function originRequestMatches(
  request: OriginRequest | null,
  target: OriginRequestTarget,
  now: number = Date.now(),
): boolean {
  return (
    request !== null &&
    request.kind === target.kind &&
    request.id === target.id &&
    now - request.requestedAt <= ORIGIN_REQUEST_TTL_MS
  );
}

/** Clear the pending request once a Created row has answered it. */
export function clearOriginRequest(): void {
  if (current === null) return;
  current = null;
  notify();
}
