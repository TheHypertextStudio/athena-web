/** A held place in a serialized optimistic-write queue. */
export interface SerializedOptimisticWriteLease {
  /** Allow the next same-key optimistic write to take its snapshot. Safe to call repeatedly. */
  release: () => void;
}

/** Per-owner tails for logical optimistic-write queues, without retaining owners strongly. */
const QUEUES = new WeakMap<object, Map<string, Promise<void>>>();

/**
 * Wait until earlier optimistic writes for one owner/key have settled, then acquire the next lease.
 *
 * @remarks
 * Whole-cache optimistic snapshots must not overlap: an older rollback would otherwise restore a
 * snapshot over a newer edit. Owners are weakly held (normally a TanStack `QueryClient`), while
 * logical keys let callers choose the cache boundary that must serialize. Releasing is idempotent
 * and removes a completed tail when it is still the newest queued write.
 *
 * @param owner - Object whose cache owns the optimistic snapshots.
 * @param key - Logical serialization boundary within that owner.
 * @returns A lease whose release unblocks the next same-key writer.
 */
export async function acquireSerializedOptimisticWrite(
  owner: object,
  key: string,
): Promise<SerializedOptimisticWriteLease> {
  let ownerQueues = QUEUES.get(owner);
  if (!ownerQueues) {
    ownerQueues = new Map();
    QUEUES.set(owner, ownerQueues);
  }

  const previous = ownerQueues.get(key) ?? Promise.resolve();
  let resolveCurrent = (): void => undefined;
  const current = new Promise<void>((resolve) => {
    resolveCurrent = resolve;
  });
  ownerQueues.set(key, current);
  await previous;

  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      resolveCurrent();
      if (ownerQueues.get(key) === current) {
        ownerQueues.delete(key);
        if (ownerQueues.size === 0) QUEUES.delete(owner);
      }
    },
  };
}
