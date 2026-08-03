/**
 * `@/components/pwa` — the installed-app behaviours: the offline write queue, its indicator, and
 * the private-cache teardown the service worker needs on sign-out.
 *
 * @remarks
 * Everything here is progressive enhancement in the strict sense: each entry point feature-detects
 * what it needs and degrades to doing nothing. With no service worker, no IndexedDB, or storage
 * denied outright, `withOfflineOutbox` stops taking responsibility for failed writes (so they fail
 * honestly and visibly, exactly as they did before this existed), the indicator renders `null`
 * because the queue is empty, and every other surface in the app is untouched.
 */
export {
  OfflineSyncIndicator,
  OfflineSyncRuntime,
  type OutboxSummary,
  syncSentence,
  useOutboxSummary,
} from './offline-sync';
export { QueuedOfflineWriteError, queuedOfflineWrite, withOfflineOutbox } from './offline-write';
export {
  OUTBOX_MAX_AGE_MS,
  OUTBOX_MAX_ATTEMPTS,
  type OutboxEntry,
  type OutboxStatus,
  type ReplayOutcome,
  afterReplay,
  classifyReplay,
  describeWrite,
  expireAged,
  isQueueableWrite,
  isReplayable,
  pendingCount,
  stalledCount,
} from './outbox-model';
export {
  canQueueWrites,
  outboxKeyFor,
  purgeAllOutboxes,
  readOutbox,
  writeOutbox,
} from './outbox-store';
export {
  discardEntry,
  drainOutbox,
  enqueueWrite,
  outboxSnapshot,
  outboxUserId,
  retryEntry,
  setOutboxUser,
  startOutboxDrain,
  subscribeOutbox,
} from './outbox';
export { purgeOfflineDocuments } from './purge-offline-documents';
