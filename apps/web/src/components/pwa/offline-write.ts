'use client';

import { UserFacingError } from '@/lib/problem';

import {
  OUTBOX_MAX_AGE_MS,
  isQueueableWrite,
  migrateReplayHeaders,
  sanitizeReplayHeaders,
} from './outbox-model';
import { captureOutboxOwner, captureOutboxRequestOwnerId, enqueueWrite } from './outbox';

/**
 * The seam where an undeliverable write becomes a queued one.
 *
 * @remarks
 * A single wrapper around the API client's `fetch`, which is the one place every typed request
 * already passes through. The wrapper admits only object commands whose domain change and
 * idempotency result commit together. Other writes retain normal fetch failure semantics.
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

/** Result of resolving a Fetch target before the wrapper delegates it. */
interface ResolvedRequestTarget {
  /** Credential-free same-origin path eligible for route admission, or `null` for other targets. */
  readonly queuePath: string | null;
  /** Whether embedded credentials make the target invalid before any network attempt. */
  readonly rejected: boolean;
}

/** Resolve every Fetch input form under the same origin and credential rules. */
function resolveRequestTarget(input: RequestInfo | URL): ResolvedRequestTarget {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, globalThis.location.origin);
    const sameOrigin = url.origin === globalThis.location.origin;
    if (sameOrigin && (url.username.length > 0 || url.password.length > 0)) {
      return { queuePath: null, rejected: true };
    }
    return {
      queuePath: sameOrigin ? `${url.pathname}${url.search}` : null,
      rejected: false,
    };
  } catch {
    return { queuePath: null, rejected: false };
  }
}

/** Read the method of a request, whatever form the caller passed it in. */
function methodOf(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input !== 'string' && !(input instanceof URL)) return input.method.toUpperCase();
  return 'GET';
}

/** Read the effective headers from either `init` or a caller-provided `Request`. */
function headersOf(input: RequestInfo | URL, init: RequestInit | undefined): HeadersInit | null {
  if (init?.headers !== undefined) return init.headers;
  if (typeof input !== 'string' && !(input instanceof URL)) return input.headers;
  return null;
}

/** Build a browser request without letting Node-style fetch reject a relative string URL. */
function requestForLiveAttempt(input: RequestInfo | URL, init: RequestInit | undefined): Request {
  const source =
    typeof input === 'string'
      ? new URL(input, globalThis.location.origin)
      : input instanceof Request
        ? input.clone()
        : input;
  return new Request(source, init);
}

/** Prepare a queueable POST so the live attempt and any replay share one request identity. */
async function preparePostAttempt(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  path: string,
  ownerId: string,
): Promise<{ readonly request: Request; readonly spare: Request; readonly headers: Headers }> {
  const prepared = requestForLiveAttempt(input, init);
  const bodyText = await prepared.clone().text();
  const headers = new Headers(prepared.headers);
  const migrated = migrateReplayHeaders({
    method: 'POST',
    path,
    body: bodyText.length > 0 ? bodyText : null,
    headers,
    legacyContentType: null,
  });
  if (migrated['Idempotency-Key']) headers.set('Idempotency-Key', migrated['Idempotency-Key']);
  headers.set('X-Docket-Replay-Owner', ownerId);
  const request = new Request(prepared, { headers });
  return { request, spare: request.clone(), headers };
}

/**
 * Wrap a `fetch` so undeliverable API writes are queued instead of lost.
 *
 * @remarks
 * Only a *rejection* is treated as undeliverable. A response — any response, including a `500` —
 * means the server spoke, and the caller's own error handling is the right place for that. So this
 * wrapper cannot mask a server error as an offline one.
 *
 * Only string bodies are queued. A `ReadableStream` or a `FormData` body cannot be serialized to
 * IndexedDB and replayed faithfully. Those requests retain their original failure.
 *
 * @param inner - The `fetch` to delegate to.
 * @returns A `fetch` with the same signature.
 */
export function withOfflineOutbox(inner: typeof fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = methodOf(input, init);
    const target = resolveRequestTarget(input);
    if (target.rejected) throw new TypeError('Credential-bearing request targets are not allowed.');
    const path = target.queuePath;
    const queueable = path !== null && isQueueableWrite(method, path);
    const asRequest = typeof input === 'string' || input instanceof URL ? null : input;
    const queueOwner = queueable ? captureOutboxOwner() : null;
    const requestOwnerId = queueable ? captureOutboxRequestOwnerId() : null;
    const liveAttemptStartedAt = queueable ? Date.now() : null;
    let liveInput = input;
    let liveInit = init;
    let replayHeaders = sanitizeReplayHeaders(headersOf(input, init));

    // Cloned BEFORE the attempt, and this ordering is the whole reason it is here rather than in the
    // catch. A `fetch` client may put the body on a `Request` instead of in `init` — Hono's does —
    // and by the time the attempt has failed that body has been consumed and cannot be read. Queuing
    // from the catch block therefore produced entries with no body at all: they replayed, the server
    // answered 200, and nothing changed. Caught by e2e/platform/pwa-offline-sync.spec.ts, which
    // checks the server's copy of the record rather than trusting the queue to have emptied.
    let spare = queueable && asRequest && init?.body === undefined ? asRequest.clone() : null;
    if (queueable) {
      if (requestOwnerId === null)
        throw new TypeError('Cannot send a queueable write without an active outbox owner.');
      const prepared = await preparePostAttempt(input, init, path, requestOwnerId);
      liveInput = prepared.request;
      liveInit = undefined;
      spare = prepared.spare;
      replayHeaders = sanitizeReplayHeaders(prepared.headers);
    }

    try {
      return await inner(liveInput, liveInit);
    } catch (caught) {
      if (!queueable) throw caught;
      const failedAt = Date.now();
      if (
        liveAttemptStartedAt === null ||
        failedAt < liveAttemptStartedAt ||
        failedAt - liveAttemptStartedAt >= OUTBOX_MAX_AGE_MS
      )
        throw caught;

      const written = await readReplayBody(init, spare);
      // A body this queue cannot serialize and re-send byte-for-byte. Replaying an approximation of
      // what someone did is worse than not replaying it, so the original failure stands.
      if (written === null) throw caught;

      const entry = await enqueueWrite(
        {
          method,
          path,
          body: written.body,
          headers: replayHeaders,
        },
        liveAttemptStartedAt,
        queueOwner,
        failedAt,
      );
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
): Promise<{ body: string | null } | null> {
  const inline = init?.body;
  if (inline !== undefined && inline !== null) {
    if (typeof inline !== 'string') return null;
    return { body: inline };
  }
  if (!spare) return { body: null };
  try {
    const text = await spare.text();
    return { body: text.length > 0 ? text : null };
  } catch {
    return null;
  }
}
