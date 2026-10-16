import { ConflictError } from '../../error';

/** Locked server-derived facts only; callers never supply retention exemptions or dependency metadata. */
export interface CopyUndoFacts {
  readonly key: string;
  readonly dependencies: readonly string[];
  readonly reservationState: 'pending' | 'consumed' | 'void';
  readonly changed: boolean;
}

/** One trusted reversal step; usage is checked transactionally after preceding parent removals. */
export interface CopyUndoStep {
  readonly entryKey: string;
  readonly action: 'check_unused' | 'archive' | 'retain_changed';
}

function invalid(): never {
  throw new ConflictError('Copy can no longer be undone');
}

/** Derive parent-before-dependency reversal from the complete trusted graph, regardless of query order. */
function dependencyIncoming(entries: readonly CopyUndoFacts[]): Map<string, number> {
  const incoming = new Map(entries.map((entry) => [entry.key, 0]));
  if (!entries.length || entries.length > 100 || incoming.size !== entries.length) invalid();
  let edges = 0;
  for (const entry of entries) {
    if (
      entry.reservationState === 'void' ||
      new Set(entry.dependencies).size !== entry.dependencies.length
    )
      invalid();
    for (const dependency of entry.dependencies) {
      const count = incoming.get(dependency);
      if (count === undefined) invalid();
      incoming.set(dependency, count + 1);
      edges++;
    }
  }
  if (edges > 2000) invalid();
  return incoming;
}
function reversalOrder(entries: readonly CopyUndoFacts[]): string[] {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  const incoming = dependencyIncoming(entries);
  const pending = entries
    .filter((entry) => incoming.get(entry.key) === 0)
    .map((entry) => entry.key)
    .sort();
  const order: string[] = [];
  while (pending.length) {
    const key = pending.shift();
    const entry = key === undefined ? undefined : byKey.get(key);
    if (!entry) invalid();
    order.push(entry.key);
    for (const dependency of entry.dependencies) {
      const count = (incoming.get(dependency) ?? 0) - 1;
      incoming.set(dependency, count);
      if (count === 0) pending.push(dependency);
    }
    pending.sort();
  }
  if (order.length !== entries.length) invalid();
  return order;
}

/**
 * Order the original graph and classify authored edits without freezing current reference decisions.
 * Removed edges on an edited parent must not retain dependencies; newly added edges must protect them.
 * @throws When trusted metadata is duplicated, incomplete, cyclic, oversized or already void.
 */
export function planTemplateCopyUndo(entries: readonly CopyUndoFacts[]): CopyUndoStep[] {
  const order = reversalOrder(entries);
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  return order.map((entryKey) => {
    const entry = byKey.get(entryKey);
    if (!entry) invalid();
    return { entryKey, action: nextAction(entry) };
  });
}

function nextAction(entry: CopyUndoFacts): CopyUndoStep['action'] {
  if (entry.changed) return 'retain_changed';
  return entry.reservationState === 'consumed' ? 'archive' : 'check_unused';
}
