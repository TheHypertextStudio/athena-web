/**
 * `@docket/api` — the live stream SSE edge (`GET /v1/stream/sse`, mounted OUTSIDE the RPC `AppType`).
 *
 * @remarks
 * Holds one long-lived Server-Sent-Events connection per browser tab and forwards the caller's
 * live {@link StreamEvent}s (published by the emit path + the webhook drain via the in-process
 * {@link subscribe} bus) as `stream-event` frames, with a periodic `ping` heartbeat so proxies
 * don't reap an idle connection. Session-authenticated (the global `sessionMiddleware` runs on
 * `*`). SSE isn't RPC-friendly, so it lives in `server.ts` next to ingest/cron — the typed
 * `/v1/hub/stream` + `/v1/orgs/:orgId/stream` reads are the paginated fallback this enhances.
 */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import type { AppEnv } from '../context';
import { AuthError } from '../error';
import { type StreamEvent, subscribe } from '../lib/event-bus';

/** Heartbeat cadence (ms) — a comment-frame ping that keeps the connection warm. */
const HEARTBEAT_MS = 25_000;

/** Live stream router: a single SSE subscription per connection. */
const streamSse = new Hono<AppEnv>().get('/sse', (c) => {
  const session = c.get('session');
  if (!session?.user) throw new AuthError();
  const userId = session.user.id;

  return streamSSE(c, async (stream) => {
    const signal = c.req.raw.signal;
    let pending: StreamEvent[] = [];
    // `notify` wakes the writer loop when an event arrives or the request aborts.
    let notify: (() => void) | null = null;
    const wake = (): void => notify?.();

    const unsubscribe = subscribe(userId, (event) => {
      pending.push(event);
      wake();
    });
    signal.addEventListener('abort', wake);

    try {
      while (!signal.aborted) {
        if (pending.length > 0) {
          const batch = pending;
          pending = [];
          for (const event of batch) {
            await stream.writeSSE({ event: 'stream-event', data: JSON.stringify(event) });
          }
          continue;
        }
        // Wait for the next event or the heartbeat deadline, whichever comes first.
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, HEARTBEAT_MS);
          notify = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        notify = null;
        // Heartbeat only when nothing arrived; the `while` re-checks `aborted` to exit.
        if (pending.length === 0) {
          await stream.writeSSE({ event: 'ping', data: '' });
        }
      }
    } finally {
      unsubscribe();
      signal.removeEventListener('abort', wake);
    }
  });
});

export default streamSse;
