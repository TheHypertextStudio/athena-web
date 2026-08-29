'use client';

import {
  OUTBOX_MAX_ATTEMPTS,
  type OutboxEntry,
  afterReplay,
  canonicalOutboxWriteTarget,
  classifyReplay,
  describeWrite,
  hasCompleteReplayContract,
  isManualRetryable,
  isReplayable,
  retryAfterTimestamp,
  sanitizeReplayHeaders,
} from './outbox-model';
import { publishOutboxHint, subscribeOutboxHints } from './outbox-channel';
import {
  loadOutbox,
  bindOutboxOwner,
  joinOutboxOwner,
  withOutboxDrainLeadership,
  withOutboxUserLock,
} from './outbox-store';

/**
 * The offline write queue's runtime — one store, one drain loop, for the whole tab.
 *
 * @remarks
 * Module state rather than React state, and deliberately. A write is queued from inside a `fetch`
 * wrapper that has no component above it, and the drain has to keep running while the person is
 * looking at any screen at all. Subscribers read it through {@link subscribeOutbox}, which is
 * `useSyncExternalStore`-shaped, so React sees a normal external store.
 *
 * The drain is strictly **serial and in order**. Two changes to the same task made offline must
 * land in the order they were made, and firing the queue in parallel would make that a race. It is
 * also the reason a refused entry does not stop the queue: it is marked and stepped over, so one
 * change the server will never accept cannot strand every change behind it.
 *
 * Replays go through `globalThis.fetch` directly, never the app's API client — the client's fetch is
 * the thing that enqueues on failure, and routing a replay back through it would let a failed replay
 * enqueue a second copy of the same write.
 */

/** The account whose queue is loaded, or `null` before a session resolves. */
let activeUserId: string | null = null;
/** Durable revocation generation owned by the active account runtime. */
let activeEpoch: string | null = null;
/** Monotonic identity generation that invalidates every older asynchronous operation. */
let activeGeneration = 0;
/** The loaded queue, oldest first. */
let entries: readonly OutboxEntry[] = [];
/** Subscribers, notified on every change. */
const listeners = new Set<() => void>();
/** The active generation's storage load, when it has not settled yet. */
let loading: { readonly generation: number; readonly promise: Promise<void> } | null = null;
/** Whether the active identity's durable queue is safe to mutate. */
let loadState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
/** Blocks new local mutations while an account change waits for started mutations to finish. */
let identityTransitioning = false;
/** Invalidates an older overlapping request to change the active account. */
let identityTransitionRequest = 0;
/** Latest session identity requested by the shell, including one still binding durable storage. */
let requestedUserId: string | null = null;
/** Started local mutations whose public completion must precede an account change. */
const activeMutationCounts = new Map<number, number>();
/** Waiters released when one generation has no started local mutations. */
const mutationWaiters = new Map<number, Set<() => void>>();
/** A session cleanup fence that keeps a replacement account outside global local-data deletion. */
let sessionTransitionGate: Promise<void> | null = null;
/** Current runtime callbacks used to reconcile accepted writes and authenticate replay failures. */
let syncListener: {
  readonly callback: () => void;
  readonly unauthorized: (owner: OutboxOwnerToken) => void;
} | null = null;

/** Stable account-generation ownership captured before an asynchronous queue operation begins. */
export interface OutboxOwnerToken {
  /** The account that owned the operation when it began. */
  readonly userId: string;
  /** The identity generation that owned the operation when it began. */
  readonly generation: number;
  /** Durable generation, or `null` when this browser cannot coordinate an offline queue. */
  readonly epoch: string | null;
}

/** An owner whose writes can be stored and replayed across tabs. */
interface DurableOutboxOwnerToken extends OutboxOwnerToken {
  readonly epoch: string;
}

/** Narrow an online session owner to one that also owns durable queue authority. */
function durableOwner(owner: OutboxOwnerToken): owner is DurableOutboxOwnerToken {
  return owner.epoch !== null;
}

/** Read the current owner, or `null` before a signed-in identity exists. */
function currentOwner(): OutboxOwnerToken | null {
  return activeUserId === null || identityTransitioning
    ? null
    : { userId: activeUserId, generation: activeGeneration, epoch: activeEpoch };
}

/**
 * Capture the account generation that must own a later offline enqueue.
 *
 * @returns The current owner token, or `null` before a signed-in identity exists.
 */
export function captureOutboxOwner(): OutboxOwnerToken | null {
  return currentOwner();
}

/**
 * Capture the account allowed to start a live object command.
 *
 * @remarks
 * Durable binding can still be pending when the authenticated shell becomes interactive. The live
 * request may proceed under that requested account, but its failure cannot be queued until a
 * durable {@link OutboxOwnerToken} exists. A sign-out cleanup fence returns `null` so no request can
 * enter while another account is waiting outside browser-wide deletion.
 *
 * @returns The active or pending session account, or `null` during destructive session cleanup.
 */
export function captureOutboxRequestOwnerId(): string | null {
  if (sessionTransitionGate !== null) return null;
  return currentOwner()?.userId ?? requestedUserId;
}

/** Check that an operation still belongs to the account generation that started it. */
function isCurrent(owner: OutboxOwnerToken): boolean {
  return (
    owner.generation === activeGeneration &&
    owner.userId === activeUserId &&
    owner.epoch === activeEpoch
  );
}

/** Check that an owner may still drive network work or the visible projection. */
function isActiveOwner(owner: OutboxOwnerToken): boolean {
  return !identityTransitioning && isCurrent(owner);
}

/**
 * Check that a captured account generation still owns the active queue.
 *
 * @param owner - The account generation captured before asynchronous work began.
 * @returns Whether that exact account generation still owns network and queue work.
 */
export function isCurrentOutboxOwner(owner: OutboxOwnerToken): boolean {
  return isActiveOwner(owner);
}

/** Register a local mutation so a normal account change cannot hide a committed enqueue. */
function beginMutation(owner: DurableOutboxOwnerToken): (() => void) | null {
  if (identityTransitioning || !isCurrent(owner)) return null;
  activeMutationCounts.set(owner.generation, (activeMutationCounts.get(owner.generation) ?? 0) + 1);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const remaining = (activeMutationCounts.get(owner.generation) ?? 1) - 1;
    if (remaining > 0) {
      activeMutationCounts.set(owner.generation, remaining);
      return;
    }
    activeMutationCounts.delete(owner.generation);
    for (const resolve of mutationWaiters.get(owner.generation) ?? []) resolve();
    mutationWaiters.delete(owner.generation);
  };
}

/** Wait until every local mutation that began under one identity has reported its durable result. */
async function waitForMutations(generation: number): Promise<void> {
  if (!activeMutationCounts.has(generation)) return;
  await new Promise<void>((resolve) => {
    const waiters = mutationWaiters.get(generation) ?? new Set<() => void>();
    waiters.add(resolve);
    mutationWaiters.set(generation, waiters);
  });
}

/** Publish the current queue to every subscriber. */
function emit(): void {
  for (const listener of listeners) listener();
}

/** Replace the in-memory projection only when the initiating identity still owns it. */
function projectEntries(owner: OutboxOwnerToken, next: readonly OutboxEntry[]): boolean {
  if (!isActiveOwner(owner)) return false;
  const removedPending = entries.some(
    (entry) =>
      (entry.status === 'queued' || entry.status === 'sending') &&
      !next.some((candidate) => candidate.id === entry.id),
  );
  entries = next;
  loadState = 'ready';
  emit();
  if (removedPending && syncListener !== null) syncListener.callback();
  return true;
}

/** Mark the active projection unreadable without replacing its last known storage state. */
function failProjection(owner: OutboxOwnerToken): void {
  if (isActiveOwner(owner)) loadState = 'failed';
}

/** Whether this runtime has joined the data-free cross-tab notification channel. */
let hintsStarted = false;

/** Reload the active projection through the same shared locks used by every other reader. */
async function refreshProjection(
  owner: DurableOutboxOwnerToken,
  now = Date.now(),
): Promise<boolean> {
  const result = await loadOutbox(owner, now);
  if (!isActiveOwner(owner)) return false;
  if (result.status === 'revoked') {
    invalidateActiveOwner();
    return false;
  }
  if (result.status === 'failed') {
    failProjection(owner);
    return false;
  }
  projectEntries(owner, result.entries);
  return true;
}

/** Join the cross-tab hint channel once for this JavaScript runtime. */
function ensureOutboxHints(): void {
  if (hintsStarted) return;
  hintsStarted = true;
  subscribeOutboxHints((hint) => {
    if (hint === 'restore') {
      const userId = requestedUserId;
      if (userId !== null) void activateOutboxUser(userId, Date.now(), true, true);
      return;
    }
    const owner = currentOwner();
    if (owner === null || !durableOwner(owner)) return;
    void refreshProjection(owner);
  });
}

/** Clear this runtime after its own durable purge or a peer's purge revokes the captured epoch. */
function resetActiveOwner(): void {
  activeGeneration += 1;
  activeUserId = null;
  activeEpoch = null;
  entries = [];
  loading = null;
  loadState = 'idle';
}

/** Cancel older account requests and clear the active projection immediately. */
function invalidateActiveOwner(): void {
  identityTransitionRequest += 1;
  identityTransitioning = false;
  resetActiveOwner();
  emit();
}

/**
 * Invalidate this tab after the durable purge has revoked every captured owner generation.
 */
export function clearOutboxOwnerForSignOut(): void {
  ensureOutboxHints();
  invalidateActiveOwner();
}

/** Result of one account-bound session cleanup fence. */
export type OutboxSessionTransitionResult<T> =
  | { readonly status: 'stale' }
  | {
      readonly status: 'completed';
      readonly value: T;
      readonly replacementRequested: boolean;
    };

/**
 * Keep a replacement account outside one session's asynchronous local cleanup.
 *
 * @remarks
 * The caller revokes durable storage before it invokes `invalidateOwner`. Once invalidated, the
 * old account cannot start another write. A concurrent {@link setOutboxUser} records its intent
 * immediately but waits on this fence before binding or loading the replacement account. Global
 * cache deletion can therefore finish without deleting data that the replacement just stored.
 *
 * @param owner - The exact account generation whose session is being cleared.
 * @param operation - Revocation and cleanup work. It must call `invalidateOwner` only after durable
 * revocation succeeds.
 * @returns The operation result and whether a newer account binding was requested while it ran.
 */
export async function withOutboxSessionTransition<T>(
  owner: OutboxOwnerToken | null,
  operation: (invalidateOwner: () => void, replacementRequested: () => boolean) => Promise<T>,
): Promise<OutboxSessionTransitionResult<T>> {
  ensureOutboxHints();
  if (sessionTransitionGate !== null || identityTransitioning) return { status: 'stale' };
  if (owner === null ? activeUserId !== null : !isCurrent(owner)) return { status: 'stale' };

  const baselineRequest = identityTransitionRequest;
  const generation = activeGeneration;
  let releaseGate!: () => void;
  sessionTransitionGate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  identityTransitioning = true;
  emit();
  let invalidated = false;

  try {
    await waitForMutations(generation);
    if (owner === null ? activeUserId !== null : !isCurrent(owner)) return { status: 'stale' };
    const replacementRequested = (): boolean => identityTransitionRequest !== baselineRequest;
    const value = await operation(() => {
      if (invalidated) return;
      invalidated = true;
      resetActiveOwner();
      emit();
    }, replacementRequested);
    return {
      status: 'completed',
      value,
      replacementRequested: replacementRequested(),
    };
  } finally {
    identityTransitioning = false;
    sessionTransitionGate = null;
    releaseGate();
    emit();
  }
}

/** Wait until account-bound browser cleanup has released the next identity. */
export async function waitForOutboxSessionTransition(): Promise<void> {
  await sessionTransitionGate;
}

/** Subscribe to queue changes. Returns the unsubscribe function. */
export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The current queue.
 *
 * @remarks
 * Returns the same array identity until something actually changes, which is what
 * `useSyncExternalStore` requires of a snapshot — returning a fresh array each call would loop.
 */
export function outboxSnapshot(): readonly OutboxEntry[] {
  return entries;
}

/** The account the queue currently belongs to. */
export function outboxUserId(): string | null {
  return activeUserId;
}

/**
 * Point the queue at an account, loading whatever it left behind.
 *
 * @remarks
 * Called whenever the session resolves. Switching to a different account replaces the in-memory
 * queue outright rather than merging: one person's unsent changes are never sent under another
 * person's session.
 *
 * @param userId - The signed-in user, or `null` when there is none.
 * @param now - Current epoch milliseconds.
 */
async function activateOutboxUser(
  userId: string | null,
  now: number,
  force: boolean,
  joinOnly = false,
): Promise<boolean> {
  ensureOutboxHints();
  requestedUserId = userId;
  if (!force && !identityTransitioning && userId === activeUserId && loadState !== 'failed') {
    await loading?.promise;
    return true;
  }
  const request = identityTransitionRequest + 1;
  identityTransitionRequest = request;
  await sessionTransitionGate;
  if (request !== identityTransitionRequest) return false;
  const previousGeneration = activeGeneration;
  identityTransitioning = true;
  entries = [];
  loadState = userId === null ? 'idle' : 'loading';
  emit();
  await waitForMutations(previousGeneration);
  if (request !== identityTransitionRequest) return false;
  const epoch =
    userId === null
      ? null
      : joinOnly
        ? await joinOutboxOwner(userId)
        : await bindOutboxOwner(userId);
  if (request !== identityTransitionRequest) return false;
  if (joinOnly && userId !== null && epoch === null) {
    identityTransitioning = false;
    resetActiveOwner();
    emit();
    return false;
  }
  const generation = activeGeneration + 1;
  activeGeneration = generation;
  activeUserId = userId;
  activeEpoch = epoch;
  identityTransitioning = false;
  loadState = userId === null ? 'idle' : epoch === null ? 'failed' : 'loading';
  // Owner waiters must observe the identity as soon as the durable binding completes. The queue
  // read can fail or stall after this point, and neither outcome may strand confirmed-session
  // cleanup behind a projection event that never arrives.
  emit();
  if (userId === null) {
    loading = null;
    return true;
  }
  if (epoch === null) {
    loading = null;
    return true;
  }

  const owner = { userId, generation, epoch } satisfies OutboxOwnerToken;
  const promise = refreshProjection(owner, now)
    .then(() => undefined)
    .finally(() => {
      if (loading?.generation === generation) loading = null;
    });
  loading = { generation, promise };
  await promise;
  return request === identityTransitionRequest;
}

/**
 * Bind the offline outbox to the current authenticated account.
 *
 * @param userId - The current account, or `null` after sign-out.
 * @param now - The timestamp used to refresh the account's queue projection.
 * @returns A promise that resolves after the account transition finishes.
 */
export async function setOutboxUser(userId: string | null, now = Date.now()): Promise<void> {
  await activateOutboxUser(userId, now, false);
}

/**
 * Rebind the account whose explicit sign-out failed and ask same-account peers to do the same.
 *
 * @param userId - The still-authenticated account that initiated sign-out.
 * @returns The restoration result, including storage failure and account supersession.
 */
export async function restoreOutboxUserAfterFailedSignOut(
  userId: string,
): Promise<'restored' | 'superseded' | 'failed'> {
  if (requestedUserId !== userId) return 'superseded';
  const restored = await activateOutboxUser(userId, Date.now(), true, true);
  if (restored) return 'restored';
  return requestedUserId === userId ? 'failed' : 'superseded';
}

/** Everything needed to replay one write later. */
export interface QueuedWriteInput {
  /** HTTP method. */
  readonly method: string;
  /** Same-origin path, including any query string. */
  readonly path: string;
  /** Serialized body, or `null`. */
  readonly body: string | null;
  /** Request-contract headers selected by the offline transport. */
  readonly headers?: unknown;
  /** Content type accepted from callers that predate the replay-header schema. */
  readonly contentType?: string | null;
}

/** A stable id for a queue entry. */
function newEntryId(): string {
  const cryptoRef = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID();
  return `outbox-${String(Date.now())}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Result of a fresh, exclusive queue transition. */
interface StoredTransition {
  /** The authoritative projection after the transition. */
  readonly entries: readonly OutboxEntry[];
  /** Whether the transition changed durable state. */
  readonly changed: boolean;
  /** Whether the initiating identity still owned the result after persistence. */
  readonly ownerCurrent: boolean;
}

/** Apply one state change to a fresh queue while peer runtimes cannot interleave. */
async function storeTransition(
  owner: DurableOutboxOwnerToken,
  now: number,
  update: (current: readonly OutboxEntry[]) => readonly OutboxEntry[],
): Promise<StoredTransition | null> {
  const finish = beginMutation(owner);
  if (finish === null) return null;
  try {
    const result = await withOutboxUserLock(owner, 'exclusive', async (transaction) => {
      if (!isCurrent(owner)) return null;
      const loaded = await transaction.read(now);
      if (loaded.status === 'failed' || !isCurrent(owner)) return null;
      const next = update(loaded.entries);
      if (next === loaded.entries) {
        return {
          entries: loaded.entries,
          changed: false,
          ownerCurrent: true,
        } satisfies StoredTransition;
      }
      if (!(await transaction.write(next))) return null;
      if (!isCurrent(owner)) {
        if (await transaction.write(loaded.entries)) return null;
        return { entries: next, changed: true, ownerCurrent: false } satisfies StoredTransition;
      }
      return { entries: next, changed: true, ownerCurrent: true } satisfies StoredTransition;
    });
    if (result.status === 'revoked') {
      if (isActiveOwner(owner)) invalidateActiveOwner();
      return null;
    }
    if (result.status === 'unavailable' || result.value === null) {
      failProjection(owner);
      return null;
    }
    projectEntries(owner, result.value.entries);
    if (result.value.changed) publishOutboxHint('change');
    return result.value;
  } finally {
    finish();
  }
}

/** Remove a stale enqueue by id without replacing concurrent queue state. */
async function removeStaleEnqueue(owner: DurableOutboxOwnerToken, id: string): Promise<boolean> {
  const result = await withOutboxUserLock(owner, 'exclusive', async (transaction) => {
    const loaded = await transaction.read(Date.now());
    if (loaded.status === 'failed') return false;
    const next = loaded.entries.filter((entry) => entry.id !== id);
    if (next.length === loaded.entries.length) return true;
    return transaction.write(next);
  });
  if (result.status === 'acquired' && result.value) publishOutboxHint('change');
  return result.status === 'acquired' && result.value;
}

/**
 * Take responsibility for a write that could not be delivered.
 *
 * @remarks
 * Returns `null` — and takes responsibility for nothing — when there is no signed-in account to
 * key the queue on, or when storage refused the write. Both cases must fail the mutation instead,
 * because a queue that cannot outlive the tab is not a queue; promising a sync from one would be
 * the fake success this whole feature exists to avoid.
 *
 * @param input - The request that failed.
 * @param now - Current epoch milliseconds.
 * @param capturedOwner - Account generation that owned the original live request.
 * @param observedAt - Time used to refresh and expire the authoritative stored queue.
 * @returns The stored entry, or `null` when the write could not be taken on.
 */
export async function enqueueWrite(
  input: QueuedWriteInput,
  now = Date.now(),
  capturedOwner: OutboxOwnerToken | null = currentOwner(),
  observedAt = now,
): Promise<OutboxEntry | null> {
  const owner = capturedOwner;
  const target = canonicalOutboxWriteTarget(input.method, input.path);
  if (owner === null || !durableOwner(owner) || target === null) return null;
  const pendingLoad = loading?.generation === owner.generation ? loading.promise : null;
  await pendingLoad;
  if (!isCurrent(owner) || loadState !== 'ready') return null;
  const pathOnly = target.path.split('?')[0] ?? target.path;
  const headers = sanitizeReplayHeaders(input.headers, input.contentType);
  const entry: OutboxEntry = {
    id: newEntryId(),
    userId: owner.userId,
    epoch: owner.epoch,
    method: target.method,
    path: target.path,
    body: input.body,
    headers,
    label: describeWrite(input.method, pathOnly),
    createdAt: now,
    notBeforeAt: null,
    attempts: 0,
    status: 'queued',
  };
  if (!hasCompleteReplayContract(entry)) return null;
  const stored = await storeTransition(owner, observedAt, (current) => [...current, entry]);
  if (stored === null) return null;
  if (!stored.ownerCurrent) return entry;
  if (!isCurrent(owner)) {
    return (await removeStaleEnqueue(owner, entry.id)) ? null : entry;
  }
  return entry;
}

/** Forget one entry — the person's answer to a change the server refused. */
export async function discardEntry(id: string): Promise<void> {
  const owner = currentOwner();
  if (owner === null || !durableOwner(owner)) return;
  await storeTransition(owner, Date.now(), (current) => {
    const next = current.filter((entry) => entry.id !== id);
    return next.length === current.length ? current : next;
  });
}

/** Give a still-young blocked entry one more chance without changing its stable request identity. */
export async function retryEntry(id: string): Promise<void> {
  const owner = currentOwner();
  if (owner === null || !durableOwner(owner)) return;
  const now = Date.now();
  const stored = await storeTransition(owner, now, (current) => {
    const target = current.find((entry) => entry.id === id && isManualRetryable(entry, now));
    if (target === undefined) return current;
    return current.map((entry) =>
      entry.id === id
        ? { ...entry, status: 'queued' as const, attempts: 0, notBeforeAt: null }
        : entry,
    );
  });
  if (stored?.changed && isCurrent(owner)) await drainOutbox();
}

/** One replay response reduced to the fields that control durable queue state. */
interface ReplayResponse {
  /** HTTP status, or `null` when nothing answered. */
  readonly status: number | null;
  /** Parsed server pacing deadline, or `null` when none was usable. */
  readonly retryAfterAt: number | null;
}

/** Send one entry and retain any server pacing deadline. */
async function attempt(
  entry: OutboxEntry,
  owner: DurableOutboxOwnerToken,
): Promise<ReplayResponse> {
  const target = canonicalOutboxWriteTarget(entry.method, entry.path);
  if (
    target === null ||
    entry.userId !== owner.userId ||
    !hasCompleteReplayContract(entry) ||
    !isActiveOwner(owner)
  )
    return { status: 400, retryAfterAt: null };
  try {
    const headers = new Headers(sanitizeReplayHeaders(entry.headers));
    headers.set('X-Docket-Replay-Owner', entry.userId);
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, OUTBOX_REPLAY_TIMEOUT_MS);
    try {
      const response = await globalThis.fetch(target.path, {
        method: target.method,
        credentials: 'include',
        headers,
        signal: controller.signal,
        ...(entry.body === null ? {} : { body: entry.body }),
      });
      return {
        status: response.status,
        retryAfterAt: retryAfterTimestamp(response.headers.get('Retry-After'), Date.now()),
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // No status: nothing was established, so the write is still owed.
    return { status: null, retryAfterAt: null };
  }
}

/** The result of replaying at most one fresh durable entry under its user lock. */
type ReplayStep =
  | { readonly state: 'done'; readonly entries: readonly OutboxEntry[] }
  | { readonly state: 'failed'; readonly entries?: readonly OutboxEntry[] }
  | { readonly state: 'stale' }
  | {
      readonly state: 'settled';
      readonly entries: readonly OutboxEntry[];
      readonly entryId: string;
      readonly outcome: ReturnType<typeof classifyReplay>;
      readonly status: number | null;
    };

/** Select, send, and persist one entry without releasing cross-tab ownership between those steps. */
async function replayOne(
  owner: DurableOutboxOwnerToken,
  visited: ReadonlySet<string>,
): Promise<ReplayStep | null> {
  const locked = await withOutboxUserLock(owner, 'exclusive', async (transaction) => {
    if (!isActiveOwner(owner)) return { state: 'stale' } satisfies ReplayStep;
    const selectionTime = Date.now();
    const loaded = await transaction.read(selectionTime);
    if (loaded.status === 'failed') {
      return { state: 'failed' } satisfies ReplayStep;
    }
    if (!isActiveOwner(owner)) return { state: 'stale' } satisfies ReplayStep;
    // A paced queued head remains an ordering barrier. Searching for any replayable entry here
    // would let a dependent later command pass it during Retry-After.
    const head = loaded.entries.find(
      (candidate) =>
        candidate.userId === owner.userId &&
        !visited.has(candidate.id) &&
        candidate.status === 'queued',
    );
    if (head === undefined || !isReplayable(head, selectionTime)) {
      return { state: 'done', entries: loaded.entries } satisfies ReplayStep;
    }
    const entry = head;

    projectEntries(
      owner,
      loaded.entries.map((candidate) =>
        candidate.id === entry.id ? { ...candidate, status: 'sending' as const } : candidate,
      ),
    );
    const response = await attempt(entry, owner);
    if (!isActiveOwner(owner)) return { state: 'stale' } satisfies ReplayStep;
    const outcome = classifyReplay(entry.method, response.status, response.retryAfterAt);
    const replayed = afterReplay(
      { ...entry, status: 'sending' },
      outcome,
      Date.now(),
      response.retryAfterAt,
    );
    const next =
      replayed === null
        ? loaded.entries.filter((candidate) => candidate.id !== entry.id)
        : loaded.entries.map((candidate) => (candidate.id === entry.id ? replayed : candidate));
    if (!(await transaction.write(next))) {
      return { state: 'failed', entries: loaded.entries } satisfies ReplayStep;
    }
    return {
      state: 'settled',
      entries: next,
      entryId: entry.id,
      outcome,
      status: response.status,
    } satisfies ReplayStep;
  });
  if (locked.status === 'revoked') {
    if (isActiveOwner(owner)) invalidateActiveOwner();
    return { state: 'stale' };
  }
  return locked.status === 'acquired' ? locked.value : null;
}

/**
 * Send everything the queue still owes, oldest first.
 *
 * @remarks
 * Safe to call at any time and from anywhere. Concurrent runtimes serialize at the per-user lock,
 * and each waiter rereads durable state before it selects an entry. An accepted entry therefore
 * disappears before a waiting drain can send it again.
 * The loop stops at the first entry that could not be delivered for want of a connection, because
 * continuing would burn every remaining entry's attempt budget on the same dead network and turn a
 * short outage into a queue full of blocked changes.
 *
 */
async function drainWave(owner: DurableOutboxOwnerToken): Promise<void> {
  const visited = new Set<string>();
  const pendingLoad = loading?.generation === owner.generation ? loading.promise : null;
  await pendingLoad;
  if (!isActiveOwner(owner)) return;
  while (isActiveOwner(owner)) {
    const step = await replayOne(owner, visited);
    if (step === null) {
      failProjection(owner);
      return;
    }
    if (step.state === 'stale') return;
    if (step.state === 'failed') {
      if (step.entries !== undefined) projectEntries(owner, step.entries);
      failProjection(owner);
      return;
    }
    projectEntries(owner, step.entries);
    if (step.state === 'done') return;
    publishOutboxHint('change');
    visited.add(step.entryId);
    if (step.status === 401) {
      syncListener?.unauthorized(owner);
      return;
    }
    if (step.outcome === 'pause' || step.outcome === 'deferred' || step.outcome === 'retry') return;
  }
}

/**
 * Send everything the queue still owes, oldest first.
 *
 */
export async function drainOutbox(): Promise<void> {
  const owner = currentOwner();
  if (
    owner === null ||
    !durableOwner(owner) ||
    (typeof navigator !== 'undefined' && !navigator.onLine)
  )
    return;
  const leadership = await withOutboxDrainLeadership(owner.userId, () => drainWave(owner));
  if (leadership.status === 'unavailable' && isActiveOwner(owner)) {
    await refreshProjection(owner, Date.now());
  }
}

/**
 * Start draining whenever the browser thinks it can reach the network.
 *
 * @remarks
 * Three triggers, because no single one is reliable. `online` is the fast path but is not fired by
 * every platform on every transition; a tab regaining focus catches the laptop that was asleep when
 * the connection came back; and the interval catches the case where the radio came back while the
 * tab stayed in the foreground and nothing fired at all. All three funnel into the same locked
 * {@link drainOutbox} path.
 *
 * @param onEntriesSynced - Invoked after any entry is accepted, so the app can refetch.
 * @param onUnauthorized - Invoked with the replay owner when the session authority must confirm a
 * `401`.
 * @returns A teardown function.
 */
export function startOutboxDrain(
  onEntriesSynced: () => void,
  onUnauthorized: (owner: OutboxOwnerToken) => void = () => undefined,
): () => void {
  const registration = { callback: onEntriesSynced, unauthorized: onUnauthorized };
  syncListener = registration;
  const kick = (): void => {
    void drainOutbox();
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') kick();
  };
  window.addEventListener('online', kick);
  document.addEventListener('visibilitychange', onVisibility);
  const timer = setInterval(kick, DRAIN_INTERVAL_MS);
  kick();
  return () => {
    window.removeEventListener('online', kick);
    document.removeEventListener('visibilitychange', onVisibility);
    clearInterval(timer);
    if (syncListener === registration) syncListener = null;
  };
}

/** How often the drain retries on its own, independent of any connectivity event. */
const DRAIN_INTERVAL_MS = 30_000;

/**
 * Maximum time one replay may own its cross-tab lock.
 *
 * @remarks
 * A timed-out response is ambiguous, so the queue pauses without spending an attempt. The object
 * command's stable key makes a later replay safe within the server's retention window.
 */
export const OUTBOX_REPLAY_TIMEOUT_MS = 30_000;

/** Re-exported so the indicator can explain the attempt budget without restating the number. */
export { OUTBOX_MAX_ATTEMPTS };
