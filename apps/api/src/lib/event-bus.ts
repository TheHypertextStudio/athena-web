/**
 * `@docket/api` — in-process pub/sub bus for live stream delivery.
 *
 * @remarks
 * The fan-out behind the Stream SSE endpoint: the emit path and the webhook drain `publish`
 * a fresh {@link StreamEventOut} to a recipient user; each open `/v1/stream/sse` connection
 * `subscribe`s and forwards events to the browser. Deliberately in-process and best-effort —
 * polling (`useLiveInfiniteApiQuery`) remains the correctness baseline, SSE is the latency
 * enhancement. Multi-instance fan-out (Postgres LISTEN/NOTIFY or Redis) is a documented
 * follow-up; until then a subscriber only receives events published on its own instance.
 */
import type { StreamEventOut } from '@docket/types';
import type { z } from 'zod';

/** The serialized event delivered over the bus (the stream DTO's wire shape). */
export type StreamEvent = z.input<typeof StreamEventOut>;

/** A subscriber callback invoked synchronously when an event is published for its user. */
type Listener = (event: StreamEvent) => void;

/** userId → its open SSE listeners. */
const subscribers = new Map<string, Set<Listener>>();

/**
 * Subscribe a listener to a user's live events.
 *
 * @param userId - The Better Auth user whose stream to follow.
 * @param listener - Invoked with each published event for that user.
 * @returns an unsubscribe function (removes the listener; prunes the empty set).
 */
export function subscribe(userId: string, listener: Listener): () => void {
  let set = subscribers.get(userId);
  if (!set) {
    set = new Set();
    subscribers.set(userId, set);
  }
  set.add(listener);
  return () => {
    const current = subscribers.get(userId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) subscribers.delete(userId);
  };
}

/**
 * Publish one event to a user's subscribers (no-op when none are connected).
 *
 * @param userId - The recipient user.
 * @param event - The serialized stream event.
 */
export function publish(userId: string, event: StreamEvent): void {
  const set = subscribers.get(userId);
  if (!set) return;
  // Copy first so a listener that unsubscribes mid-iteration can't mutate the live set.
  for (const listener of [...set]) listener(event);
}

/** Test/inspection helper: how many listeners are attached for a user. */
export function listenerCount(userId: string): number {
  return subscribers.get(userId)?.size ?? 0;
}
