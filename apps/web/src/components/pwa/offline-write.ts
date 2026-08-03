'use client';

import { UserFacingError } from '@/lib/problem';

import { isQueueableWrite } from './outbox-model';
import { enqueueWrite } from './outbox';

/**
 * The seam where an undeliverable write becomes a queued one.
 *
 * @remarks
 * A single wrapper around the API client's `fetch`, which is the only place in the app where every
 * write already passes through one function. Doing it here rather than at each of the ~120 call
 * sites is what makes offline writing a property of the app instead of a feature some screens
 * remembered to implement.
 *
 * **It never invents a server response.** The tempting shortcut — answer the queued request with a
 * synthetic `200` and a plausible body — would make every caller believe the server had spoken, and
 * would require fabricating ids the server has not issued. Instead the call rejects with a
 * {@link QueuedOfflineWriteError} carrying application-owned copy that says exactly what happened:
 * the change is on the device and will be sent. Callers that show an error message show that
 * sentence; the mutation layer recognises the type and keeps the optimistic cache rather than
 * rolling it back; and the sync indicator lists the change until it lands.
 */

/**
 * A write that could not be delivered and has been stored for replay.
 *
 * @remarks
 * A `UserFacingError` subclass, so every existing inline error treatment in the app renders its
 * message unchanged — and the message is the honest one. `status` is `0`, matching the convention
 * the data layer already uses for "no response was ever received".
 *
 * This is not a failure and must not be presented as one where the difference is visible: see
 * `useApiMutation`, which checks for it before letting a caller's `onError` roll anything back.
 */
export class QueuedOfflineWriteError extends UserFacingError {
  /** Always 0 — nothing answered. */
  override readonly status: number;
  /** The queue entry that now owns this change. */
  readonly entryId: string;

  constructor(entryId: string) {
    super("Saved on this device. Docket will sync it as soon as you're back online.", {
      status: 0,
    });
    this.name = 'QueuedOfflineWriteError';
    this.status = 0;
    this.entryId = entryId;
  }
}

/**
 * Whether a thrown value means "this change is queued", looking through any wrapping.
 *
 * @remarks
 * `unwrap` in the data layer converts a rejected request into an `ApiRequestError` and keeps the
 * original as `cause`, so by the time a mutation's `onError` sees it the queued error is one or two
 * levels down. Walking the chain here — rather than changing `unwrap` — keeps the server-safe data
 * core free of any dependency on the offline queue.
 *
 * @param error - Any thrown value.
 * @returns The queued-write error, or `null` when this was an ordinary failure.
 */
export function queuedOfflineWrite(error: unknown): QueuedOfflineWriteError | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    if (current instanceof QueuedOfflineWriteError) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** Read the path of a request, whatever form the caller passed it in. */
function pathOf(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    const url = new URL(raw, globalThis.location.origin);
    return `${url.pathname}${url.search}`;
  } catch {
    return raw;
  }
}

/** Read the method of a request, whatever form the caller passed it in. */
function methodOf(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input !== 'string' && !(input instanceof URL)) return input.method.toUpperCase();
  return 'GET';
}

/** Read a header from whatever `HeadersInit` shape the caller used. */
function headerOf(init: RequestInit | undefined, name: string): string | null {
  const headers = init?.headers;
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return found?.[1] ?? null;
  }
  const record = headers;
  const key = Object.keys(record).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase(),
  );
  return key === undefined ? null : (record[key] ?? null);
}

/**
 * Wrap a `fetch` so undeliverable API writes are queued instead of lost.
 *
 * @remarks
 * Only a *rejection* is treated as undeliverable. A response — any response, including a `500` —
 * means the server spoke, and the caller's own error handling is the right place for that. So this
 * wrapper cannot mask a server error as an offline one.
 *
 * Only string and `URL` bodies are queued. A `ReadableStream` or a `FormData` body cannot be
 * serialized to IndexedDB and replayed faithfully, and pretending otherwise would produce a replay
 * that quietly sent something different from what the person did; those rethrow unchanged.
 *
 * @param inner - The `fetch` to delegate to.
 * @returns A `fetch` with the same signature.
 */
export function withOfflineOutbox(inner: typeof fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = methodOf(input, init);
    const path = pathOf(input);
    const pathOnly = path.split('?')[0] ?? path;
    const queueable = isQueueableWrite(method, pathOnly);
    const asRequest = typeof input === 'string' || input instanceof URL ? null : input;

    // Cloned BEFORE the attempt, and this ordering is the whole reason it is here rather than in the
    // catch. A `fetch` client may put the body on a `Request` instead of in `init` — Hono's does —
    // and by the time the attempt has failed that body has been consumed and cannot be read. Queuing
    // from the catch block therefore produced entries with no body at all: they replayed, the server
    // answered 200, and nothing changed. Caught by e2e/platform/pwa-offline-sync.spec.ts, which
    // checks the server's copy of the record rather than trusting the queue to have emptied.
    const spare = queueable && asRequest && init?.body === undefined ? asRequest.clone() : null;

    try {
      return await inner(input, init);
    } catch (caught) {
      if (!queueable) throw caught;

      const written = await readReplayBody(init, spare);
      // A body this queue cannot serialize and re-send byte-for-byte. Replaying an approximation of
      // what someone did is worse than not replaying it, so the original failure stands.
      if (written === null) throw caught;

      const entry = await enqueueWrite({
        method,
        path,
        body: written.body,
        contentType: written.contentType ?? asRequest?.headers.get('content-type') ?? null,
      });
      // No signed-in account, or storage refused the entry. Nothing took responsibility for the
      // change, so the original failure is the truth and must reach the caller unchanged.
      if (entry === null) throw caught;
      throw new QueuedOfflineWriteError(entry.id);
    }
  };
}

/** What a replay will send, or `null` when this request cannot be replayed faithfully. */
async function readReplayBody(
  init: RequestInit | undefined,
  spare: Request | null,
): Promise<{ body: string | null; contentType: string | null } | null> {
  const inline = init?.body;
  if (inline !== undefined && inline !== null) {
    if (typeof inline !== 'string') return null;
    return { body: inline, contentType: headerOf(init, 'content-type') };
  }
  if (!spare) return { body: null, contentType: headerOf(init, 'content-type') };
  try {
    const text = await spare.text();
    return {
      body: text.length > 0 ? text : null,
      contentType: spare.headers.get('content-type'),
    };
  } catch {
    return null;
  }
}
