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
 * **Only same-origin API writes are ever queued.** Auth traffic is excluded by name: replaying a
 * sign-in or a passkey ceremony later would be both useless and alarming.
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

/** One durable, replayable write. */
export interface OutboxEntry {
  /** Client-generated identifier, stable across reloads and replays. */
  readonly id: string;
  /** The account that made the write. A queue is never replayed for anyone else. */
  readonly userId: string;
  /** HTTP method. */
  readonly method: string;
  /** Same-origin path, including query string. */
  readonly path: string;
  /** Serialized request body, or `null` for a bodiless write. */
  readonly body: string | null;
  /** The body's content type, preserved so the replay sends what the original sent. */
  readonly contentType: string | null;
  /** Application-owned description, shown to the person while the write is pending. */
  readonly label: string;
  /** When the person made the change. */
  readonly createdAt: number;
  /** How many replay attempts have been made. */
  readonly attempts: number;
  /** Current state. */
  readonly status: OutboxStatus;
}

/**
 * How long an unsent write stays replayable.
 *
 * @remarks
 * Matches the persisted query cache's own 24-hour window, and for the same reason: past a day, the
 * server state the change was made against is no longer plausibly the state it would land on. An
 * expired entry is not deleted — it stays visible and says it was not sent, which is the honest
 * outcome. Silently dropping it would be the one behaviour worse than sending it late.
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

/** Paths that may be queued, in the order they are matched. */
const WRITE_LABELS: readonly {
  readonly method: string;
  readonly pattern: RegExp;
  readonly label: string;
}[] = [
  { method: 'POST', pattern: /^\/v1\/orgs\/[^/]+\/tasks$/, label: 'New task' },
  { method: 'PATCH', pattern: /^\/v1\/orgs\/[^/]+\/tasks\/[^/]+$/, label: 'Task change' },
  { method: 'DELETE', pattern: /^\/v1\/orgs\/[^/]+\/tasks\/[^/]+$/, label: 'Archived task' },
  { method: 'POST', pattern: /^\/v1\/orgs\/[^/]+\/tasks\/[^/]+\/comments$/, label: 'Comment' },
  { method: 'POST', pattern: /^\/v1\/orgs\/[^/]+\/projects$/, label: 'New project' },
  { method: 'PATCH', pattern: /^\/v1\/orgs\/[^/]+\/projects\/[^/]+$/, label: 'Project change' },
];

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
  const upper = method.toUpperCase();
  for (const rule of WRITE_LABELS) {
    if (rule.method === upper && rule.pattern.test(path)) return rule.label;
  }
  return GENERIC_LABELS[upper] ?? 'Change';
}

/**
 * Whether a failed request is one this queue is allowed to take responsibility for.
 *
 * @remarks
 * Three conditions. It must be a write — a failed read has nothing to replay and is already
 * presented as an offline read. It must be the typed API (`/v1`), because that is the only surface
 * whose semantics this app controls. And it must not be auth traffic: replaying a sign-in, a
 * passkey registration or a sign-out minutes later is at best useless and at worst frightening.
 *
 * @param method - HTTP method, any case.
 * @param path - Same-origin path.
 * @returns Whether the request may be queued.
 */
export function isQueueableWrite(method: string, path: string): boolean {
  const upper = method.toUpperCase();
  if (upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS') return false;
  if (path === '/api/auth' || path.startsWith('/api/auth/')) return false;
  return path === '/v1' || path.startsWith('/v1/');
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
  return entry.attempts < OUTBOX_MAX_ATTEMPTS;
}

/** What a replay attempt established. */
export type ReplayOutcome =
  /** The server accepted it. The entry is done and leaves the queue. */
  | 'accepted'
  /** Nothing was established — no connection, or the server is temporarily unable. Try again. */
  | 'retry'
  /** The server understood and refused. Retrying cannot change that. */
  | 'refused';

/**
 * Classify a replay attempt from its HTTP status.
 *
 * @remarks
 * The distinction that matters is *refused* versus *not yet answered*. A `409` or a `422` means the
 * world moved on — the task was archived, the value is no longer valid — and re-sending it a
 * hundred times cannot help; it needs a person. A `503`, a `429`, or no response at all establishes
 * nothing, so the write is still owed.
 *
 * `401` is deliberately a retry, not a refusal: a queued write reaching a server that wants a fresh
 * session is not a rejected change, and discarding someone's work because their cookie rotated
 * while they were on a train would be indefensible.
 *
 * @param status - HTTP status, or `null` when the request never got an answer.
 * @returns What to do with the entry.
 */
export function classifyReplay(status: number | null): ReplayOutcome {
  if (status === null) return 'retry';
  if (status >= 200 && status < 300) return 'accepted';
  if (status === 401 || status === 408 || status === 425 || status === 429) return 'retry';
  if (status >= 500) return 'retry';
  return 'refused';
}

/**
 * Apply an attempt's outcome to an entry.
 *
 * @param entry - The entry that was attempted.
 * @param outcome - What the attempt established.
 * @param now - Current epoch milliseconds.
 * @returns The next entry, or `null` when it is finished and should leave the queue.
 */
export function afterReplay(
  entry: OutboxEntry,
  outcome: ReplayOutcome,
  now: number,
): OutboxEntry | null {
  if (outcome === 'accepted') return null;
  const attempts = entry.attempts + 1;
  if (outcome === 'refused') return { ...entry, attempts, status: 'blocked' };
  if (now - entry.createdAt > OUTBOX_MAX_AGE_MS) return { ...entry, attempts, status: 'expired' };
  if (attempts >= OUTBOX_MAX_ATTEMPTS) return { ...entry, attempts, status: 'blocked' };
  return { ...entry, attempts, status: 'queued' };
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
  return entries.map((entry) =>
    entry.status === 'queued' && now - entry.createdAt > OUTBOX_MAX_AGE_MS
      ? { ...entry, status: 'expired' as const }
      : entry.status === 'sending'
        ? // A 'sending' entry restored from disk means the tab died mid-flight. It is owed again:
          // the request either never landed, or landed and will be reconciled by the refetch that
          // follows a successful replay.
          { ...entry, status: 'queued' as const }
        : entry,
  );
}

/** How many entries are still waiting to reach the server. */
export function pendingCount(entries: readonly OutboxEntry[]): number {
  return entries.filter((entry) => entry.status === 'queued' || entry.status === 'sending').length;
}

/** How many entries need a person before they can go anywhere. */
export function stalledCount(entries: readonly OutboxEntry[]): number {
  return entries.filter((entry) => entry.status === 'blocked' || entry.status === 'expired').length;
}
