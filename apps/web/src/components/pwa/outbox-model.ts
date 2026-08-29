/**
 * The offline write queue's rules, as pure functions.
 *
 * @remarks
 * No React, no IndexedDB, no `fetch`. Everything here is a decision — what may be queued, what may
 * be replayed, what a replay attempt meant — so the parts that are expensive to get wrong can be
 * tested exhaustively without a browser.
 *
 * **Why a queue exists at all, given the codebase used to refuse one.** `query-persistence.tsx`
 * still says a persisted TanStack *mutation* is an offline write queue by another name, and it is
 * right: TanStack's `networkMode: 'online'` pauses a mutation indefinitely and resumes it with no
 * record, no expiry, no attempt limit and nothing on screen. That is a write firing hours later
 * against a server whose state has moved on, with nobody watching. This queue is the opposite in
 * every one of those respects: each entry is durable and inspectable, carries the moment it was
 * made, expires ({@link OUTBOX_MAX_AGE_MS}), gives up after {@link OUTBOX_MAX_ATTEMPTS}, is refused
 * outright by the server rather than retried when the server says no, and is visible the entire
 * time it is pending. `shouldDehydrateMutation` stays `false` — this replaces it, it does not
 * reopen it.
 *
 * **Only same-origin object commands are ever queued.** Their domain change and idempotency result
 * commit in the same database transaction. Ordinary POST, PATCH, and DELETE routes do not provide
 * that atomic contract, so a lost live response on those routes reaches the caller unchanged.
 */

/** Where one queued write stands. */
export type OutboxStatus =
  /** Waiting for a connection. The normal state. */
  | 'queued'
  /** A replay attempt is in flight. */
  | 'sending'
  /** The server refused it, or it ran out of attempts. Needs a person; never retried silently. */
  | 'blocked'
  /** It sat unsent past {@link OUTBOX_MAX_AGE_MS} and will not be sent. */
  | 'expired';

/** Headers the queue may persist and replay. */
export type OutboxReplayHeaders = Readonly<
  Partial<Record<'Content-Type' | 'Idempotency-Key', string>>
>;

/** One durable, replayable write. */
export interface OutboxEntry {
  /** Client-generated identifier, stable across reloads and replays. */
  readonly id: string;
  /** The account that made the write. A queue is never replayed for anyone else. */
  readonly userId: string;
  /** Durable revocation generation that owned the write. */
  readonly epoch: string;
  /** HTTP method. */
  readonly method: string;
  /** Same-origin path, including query string. */
  readonly path: string;
  /** Serialized request body, or `null` for a bodiless write. */
  readonly body: string | null;
  /** The small allowlist of request-contract headers that must survive replay. */
  readonly headers: OutboxReplayHeaders;
  /** Application-owned description, shown to the person while the write is pending. */
  readonly label: string;
  /** When the person made the change. */
  readonly createdAt: number;
  /** Earliest server-approved replay time, or `null` when no pacing deadline applies. */
  readonly notBeforeAt: number | null;
  /** How many replay attempts have been made. */
  readonly attempts: number;
  /** Current state. */
  readonly status: OutboxStatus;
}

/** The canonical request line the queue is allowed to persist and replay. */
export interface OutboxWriteTarget {
  /** Approved HTTP write method in upper case. */
  readonly method: 'POST';
  /** Canonical same-origin typed API path, including its query string. */
  readonly path: string;
  /** Application-owned description for the pending-change surface. */
  readonly label: string;
  /** Extra replay evidence required beyond the stored request line. */
  readonly contract: 'object-command';
}

const OUTBOX_VALIDATION_ORIGIN = 'https://docket.invalid';

/** The complete set of API writes whose domain result and idempotency record commit together. */
const OUTBOX_ROUTE_POLICIES: readonly {
  readonly method: OutboxWriteTarget['method'];
  readonly pathname: RegExp;
  readonly label: string;
  readonly contract: OutboxWriteTarget['contract'];
}[] = [
  {
    method: 'POST',
    pathname: /^\/v1\/orgs\/[^/]+\/object-commands$/u,
    label: 'Object change',
    contract: 'object-command',
  },
];

/**
 * Validate and canonicalize one queued request line without accepting an origin from its caller.
 *
 * @param method - Proposed HTTP method.
 * @param path - Proposed relative request target.
 * @returns The canonical write target, or `null` when the queue must not own it.
 */
export function canonicalOutboxWriteTarget(method: string, path: string): OutboxWriteTarget | null {
  const upper = method.toUpperCase();
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  try {
    const url = new URL(path, OUTBOX_VALIDATION_ORIGIN);
    const canonicalPath = `${url.pathname}${url.search}`;
    if (url.origin !== OUTBOX_VALIDATION_ORIGIN || canonicalPath !== path) return null;
    const policy = OUTBOX_ROUTE_POLICIES.find(
      (candidate) => candidate.method === upper && candidate.pathname.test(url.pathname),
    );
    return policy === undefined
      ? null
      : {
          method: policy.method,
          path: canonicalPath,
          label: policy.label,
          contract: policy.contract,
        };
  } catch {
    return null;
  }
}

/** Read one header from a persisted or live header collection. */
function replayHeaderValue(value: unknown, name: string): string | null {
  if (typeof Headers !== 'undefined' && value instanceof Headers) return value.get(name);
  if (Array.isArray(value)) {
    const entries: readonly unknown[] = value;
    for (const entry of entries) {
      if (!Array.isArray(entry)) continue;
      const pair: readonly unknown[] = entry;
      if (
        typeof pair[0] === 'string' &&
        pair[0].toLowerCase() === name.toLowerCase() &&
        typeof pair[1] === 'string'
      )
        return pair[1];
    }
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Readonly<Record<string, unknown>>;
  const key = Object.keys(record).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase(),
  );
  return key !== undefined && typeof record[key] === 'string' ? record[key] : null;
}

/** Keep a header value only when a browser can safely replay it. */
function safeReplayHeaderValue(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length === 0 || trimmed.length > 8_192 || /[\r\n]/u.test(trimmed)) return null;
  return trimmed;
}

/**
 * Reduce live or stored headers to the queue's explicit replay allowlist.
 *
 * @param value - Any live or persisted header representation.
 * @param legacyContentType - The content type used by queue entries written before headers existed.
 * @returns Canonically named headers safe to persist and replay.
 */
export function sanitizeReplayHeaders(
  value: unknown,
  legacyContentType: unknown = null,
): OutboxReplayHeaders {
  const contentType = safeReplayHeaderValue(
    replayHeaderValue(value, 'Content-Type') ??
      (typeof legacyContentType === 'string' ? legacyContentType : null),
  );
  const idempotencyKey = safeReplayHeaderValue(replayHeaderValue(value, 'Idempotency-Key'));
  return {
    ...(contentType === null ? {} : { 'Content-Type': contentType }),
    ...(idempotencyKey === null ? {} : { 'Idempotency-Key': idempotencyKey }),
  };
}

/** Read a command id without trusting any other persisted body field. */
function objectCommandId(body: string | null): string | null {
  if (body === null) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const commandId = (parsed as Readonly<Record<string, unknown>>)['commandId'];
    return typeof commandId === 'string' ? safeReplayHeaderValue(commandId) : null;
  } catch {
    return null;
  }
}

/**
 * Recover the one header an old object-command entry can derive without inventing request data.
 *
 * @param input - The stored request line, body, and old/new header fields.
 * @returns Sanitized replay headers, with a legacy command key recovered from its matching body.
 */
export function migrateReplayHeaders(input: {
  readonly method: string;
  readonly path: string;
  readonly body: string | null;
  readonly headers: unknown;
  readonly legacyContentType: unknown;
}): OutboxReplayHeaders {
  const headers = sanitizeReplayHeaders(input.headers, input.legacyContentType);
  const target = canonicalOutboxWriteTarget(input.method, input.path);
  if (target?.contract !== 'object-command' || headers['Idempotency-Key']) return headers;
  const commandId = objectCommandId(input.body);
  return commandId === null ? headers : { ...headers, 'Idempotency-Key': commandId };
}

/**
 * Whether replay has every request-contract field needed to send the stored write faithfully.
 *
 * @param input - The stored request.
 * @returns Whether replay may claim responsibility for the write.
 */
export function hasCompleteReplayContract(input: {
  readonly method: string;
  readonly path: string;
  readonly body: string | null;
  readonly headers: OutboxReplayHeaders;
}): boolean {
  const target = canonicalOutboxWriteTarget(input.method, input.path);
  if (target === null) return false;
  if (!input.headers['Idempotency-Key']) return false;
  const contentType = input.headers['Content-Type']?.split(';', 1)[0]?.trim().toLowerCase();
  const commandId = objectCommandId(input.body);
  return (
    contentType === 'application/json' &&
    commandId !== null &&
    input.headers['Idempotency-Key'] === commandId
  );
}

/**
 * How long an unsent write stays replayable.
 *
 * @remarks
 * The API retains atomically completed object-command keys for 48 hours. The shorter 24-hour client
 * window leaves a full-window server margin for a delayed or lost live response. An expired entry
 * is never retried. It stays visible until the person discards it.
 */
export const OUTBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * How many times a write is retried before it stops trying.
 *
 * @remarks
 * Retries only ever happen for failures that are plausibly transient (no connection, a 5xx, a
 * throttle). Five is enough to ride out a flaky reconnect and few enough that a genuinely
 * unacceptable request surfaces to a person quickly instead of hammering the API forever.
 */
export const OUTBOX_MAX_ATTEMPTS = 5;

/** Fallback descriptions, so a write is never listed as an opaque URL. */
const GENERIC_LABELS: Readonly<Record<string, string>> = {
  POST: 'New item',
  PUT: 'Change',
  PATCH: 'Change',
  DELETE: 'Removal',
};

/**
 * Describe a write in the product's own words.
 *
 * @remarks
 * Application-owned copy, chosen from the request line alone. Nothing derived from a response, a
 * provider, or an exception ever reaches this string — a pending-change list is exactly the kind of
 * surface where a leaked `TypeError: Failed to fetch` would otherwise end up.
 *
 * @param method - HTTP method, any case.
 * @param path - Same-origin path, without the query string.
 * @returns A short human description of the change.
 */
export function describeWrite(method: string, path: string): string {
  const target = canonicalOutboxWriteTarget(method, path);
  if (target !== null) return target.label;
  const upper = method.toUpperCase();
  return GENERIC_LABELS[upper] ?? 'Change';
}

/**
 * Whether a failed request is one this queue is allowed to take responsibility for.
 *
 * @remarks
 * Today this admits only `POST /v1/orgs/:orgId/object-commands`. That route commits its domain
 * mutation and completed idempotency record together. A key on any other POST is insufficient,
 * and PATCH or DELETE cannot make a lost response repeat-safe after server state moves on.
 *
 * @param method - HTTP method, any case.
 * @param path - Same-origin path.
 * @returns Whether the request may be queued.
 */
export function isQueueableWrite(method: string, path: string): boolean {
  return canonicalOutboxWriteTarget(method, path) !== null;
}

/**
 * Whether an entry should be attempted now.
 *
 * @param entry - The queued write.
 * @param now - Current epoch milliseconds.
 * @returns Whether a replay should be attempted.
 */
export function isReplayable(entry: OutboxEntry, now: number): boolean {
  if (entry.status !== 'queued') return false;
  if (now - entry.createdAt > OUTBOX_MAX_AGE_MS) return false;
  if (entry.notBeforeAt !== null && now < entry.notBeforeAt) return false;
  return entry.attempts < OUTBOX_MAX_ATTEMPTS;
}

/**
 * Whether a person may release one blocked entry back to the automatic drain.
 *
 * @param entry - The blocked write under review.
 * @param now - Current epoch milliseconds.
 * @returns Whether the stable key is young, complete, and past any server pacing deadline.
 */
export function isManualRetryable(entry: OutboxEntry, now: number): boolean {
  return (
    entry.status === 'blocked' &&
    now - entry.createdAt <= OUTBOX_MAX_AGE_MS &&
    (entry.notBeforeAt === null || now >= entry.notBeforeAt) &&
    hasCompleteReplayContract(entry)
  );
}

/** Largest millisecond timestamp accepted by JavaScript's `Date`. */
const MAX_DATE_MS = 8_640_000_000_000_000;
/** Standard IMF-fixdate form that HTTP senders generate for `Retry-After`. */
const HTTP_DATE_PATTERN =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/u;

/**
 * Parse an HTTP `Retry-After` value into a replay deadline.
 *
 * @param value - Header value from the server.
 * @param now - Response time in epoch milliseconds.
 * @returns A safe epoch-millisecond deadline, or `null` for malformed input.
 */
export function retryAfterTimestamp(value: string | null, now: number): number | null {
  if (value === null || !Number.isFinite(now) || now < 0) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || /[\r\n]/u.test(trimmed)) return null;
  if (/^\d+$/u.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isSafeInteger(seconds)) return null;
    const deadline = now + seconds * 1_000;
    return Number.isSafeInteger(deadline) && deadline <= MAX_DATE_MS ? deadline : null;
  }
  if (!HTTP_DATE_PATTERN.test(trimmed)) return null;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_DATE_MS) return null;
  return Math.max(now, parsed);
}

/** What a replay attempt established. */
export type ReplayOutcome =
  /** The server accepted it. The entry is done and leaves the queue. */
  | 'accepted'
  /** Nothing answered, or the session needs confirmation. Wait without spending an attempt. */
  | 'pause'
  /** The same idempotency key is still in progress. Wait without spending an attempt. */
  | 'deferred'
  /** The server answered but asked the client to try later. */
  | 'retry'
  /** The server understood and refused. Retrying cannot change that. */
  | 'refused';

/**
 * Classify a replay attempt from its HTTP status.
 *
 * @remarks
 * The distinction that matters is *refused* versus *not yet answered*. A generic `409` or a `422`
 * means the world moved on and needs a person. A `409` with `Retry-After` means the same stable key
 * is still executing, so it waits without spending the server-failure budget. A `503` or `429`
 * spends one attempt but keeps the write queued until the server's deadline.
 *
 * `401` and no response pause rather than retry. Neither answer proves the request itself failed,
 * so neither consumes the finite server-retry budget.
 *
 * @param method - Stored HTTP method.
 * @param status - HTTP status, or `null` when the request never got an answer.
 * @param retryAfterAt - Parsed pacing deadline, or `null` when the response supplied none.
 * @returns What to do with the entry.
 */
export function classifyReplay(
  method: string,
  status: number | null,
  retryAfterAt: number | null = null,
): ReplayOutcome {
  if (status === null || status === 401) return 'pause';
  if (method.toUpperCase() !== 'POST') return 'refused';
  if (status >= 200 && status < 300) return 'accepted';
  if (status === 409 && retryAfterAt !== null) return 'deferred';
  if (status === 408 || status === 425 || status === 429) return 'retry';
  if (status >= 500) return 'retry';
  return 'refused';
}

/**
 * Apply an attempt's outcome to an entry.
 *
 * @param entry - The entry that was attempted.
 * @param outcome - What the attempt established.
 * @param now - Current epoch milliseconds.
 * @param retryAfterAt - Parsed pacing deadline, or `null` when none applies.
 * @returns The next entry, or `null` when it is finished and should leave the queue.
 */
export function afterReplay(
  entry: OutboxEntry,
  outcome: ReplayOutcome,
  now: number,
  retryAfterAt: number | null = null,
): OutboxEntry | null {
  if (outcome === 'accepted') return null;
  if (outcome === 'pause') {
    return now - entry.createdAt > OUTBOX_MAX_AGE_MS
      ? { ...entry, status: 'expired', notBeforeAt: null }
      : { ...entry, status: 'queued', notBeforeAt: null };
  }
  if (outcome === 'deferred') {
    return now - entry.createdAt > OUTBOX_MAX_AGE_MS
      ? { ...entry, status: 'expired', notBeforeAt: null }
      : {
          ...entry,
          status: 'queued',
          notBeforeAt: retryAfterAt !== null && retryAfterAt > now ? retryAfterAt : null,
        };
  }
  const attempts = entry.attempts + 1;
  if (outcome === 'refused') return { ...entry, attempts, status: 'blocked', notBeforeAt: null };
  if (now - entry.createdAt > OUTBOX_MAX_AGE_MS)
    return { ...entry, attempts, status: 'expired', notBeforeAt: null };
  const notBeforeAt = retryAfterAt !== null && retryAfterAt > now ? retryAfterAt : null;
  if (attempts >= OUTBOX_MAX_ATTEMPTS)
    return { ...entry, attempts, status: 'blocked', notBeforeAt };
  return {
    ...entry,
    attempts,
    status: 'queued',
    notBeforeAt,
  };
}

/**
 * Move any entry that has aged out into {@link OutboxStatus | expired}.
 *
 * @remarks
 * Run on load rather than on a timer: the interesting case is a queue restored from disk after the
 * browser was closed for two days, which no live timer would have been running for.
 *
 * @param entries - The queue as restored.
 * @param now - Current epoch milliseconds.
 * @returns The queue with aged entries marked, preserving order.
 */
export function expireAged(entries: readonly OutboxEntry[], now: number): readonly OutboxEntry[] {
  return entries.map((entry) => {
    if (entry.status === 'expired') return entry;
    if (now - entry.createdAt > OUTBOX_MAX_AGE_MS) return { ...entry, status: 'expired' as const };
    if (entry.status === 'blocked') return entry;
    if (entry.attempts >= OUTBOX_MAX_ATTEMPTS) return { ...entry, status: 'blocked' as const };
    if (entry.status === 'sending') {
      // A restored `sending` entry means the tab died before it could persist the result.
      return { ...entry, status: 'queued' as const };
    }
    return entry;
  });
}

/** How many entries are still waiting to reach the server. */
export function pendingCount(entries: readonly OutboxEntry[]): number {
  return entries.filter((entry) => entry.status === 'queued' || entry.status === 'sending').length;
}

/** How many entries need a person before they can go anywhere. */
export function stalledCount(entries: readonly OutboxEntry[]): number {
  return entries.filter((entry) => entry.status === 'blocked' || entry.status === 'expired').length;
}
