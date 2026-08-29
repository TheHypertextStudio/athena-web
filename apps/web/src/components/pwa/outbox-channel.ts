'use client';

/** The cross-tab channel used only to announce that durable queue state changed. */
const OUTBOX_CHANNEL_NAME = 'docket.outbox.v1';

/** A hint contains no account, request, or queue data. */
export type OutboxChangeHint = 'change' | 'purge' | 'restore';

/** Listeners registered by this tab's outbox runtime. */
const listeners = new Set<(hint: OutboxChangeHint) => void>();
/** One lazily-created channel per JavaScript runtime. */
let channel: BroadcastChannel | null = null;
/** A failed optional channel stays disabled for this runtime. */
let channelDisabled = false;

/** Return the channel when this browser supports it. */
function getChannel(): BroadcastChannel | null {
  if (channel !== null) return channel;
  if (channelDisabled || typeof BroadcastChannel === 'undefined') return null;
  try {
    channel = new BroadcastChannel(OUTBOX_CHANNEL_NAME);
  } catch {
    channelDisabled = true;
    return null;
  }
  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (event.data !== 'change' && event.data !== 'purge' && event.data !== 'restore') return;
    for (const listener of listeners) listener(event.data);
  };
  return channel;
}

/**
 * Subscribe to cross-tab queue hints.
 *
 * @param listener - Receives a data-free hint after another runtime changes durable state.
 * @returns A function that removes the listener.
 */
export function subscribeOutboxHints(listener: (hint: OutboxChangeHint) => void): () => void {
  listeners.add(listener);
  getChannel();
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Tell peer runtimes to perform their own locked read.
 *
 * @param hint - Whether durable state changed, every queue was purged, or a failed sign-out
 * restored the still-authenticated account.
 */
export function publishOutboxHint(hint: OutboxChangeHint): void {
  try {
    getChannel()?.postMessage(hint);
  } catch {
    try {
      channel?.close();
    } catch {
      // The failed optional transport has no further cleanup contract.
    }
    channel = null;
    channelDisabled = true;
    // Hints only shorten peer convergence. Every operation still begins with a locked fresh read.
  }
}
