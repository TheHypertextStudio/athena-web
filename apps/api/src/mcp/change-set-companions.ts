/**
 * `@docket/api` — the change-set entry kinds that `change-set.ts` hands off to other modules.
 *
 * @remarks
 * `change-set.ts` reverses work items and relations itself. Label-set snapshots and catalog rows
 * (labels, label groups, templates) have their own rules for reversal, and they live in
 * `change-set-labels.ts` and `change-set-catalog.ts`. This module is the one place that decides
 * which module an entry belongs to, so both undo paths dispatch the same way. `change-set.ts` is
 * pinned at its size in the complexity ledger, which is why the dispatch is not inline there.
 */
import { db, type changeSetEntry } from '@docket/db';

import type { Tx, UndoOutcome } from './change-set';
import { isCatalogKind, revertCatalogEntry } from './change-set-catalog';
import { isLabelSetKind, revertLabelSet } from './change-set-labels';

/** A stored change-set entry, as undo reads it back; `op` is widened to match `revertEntry`. */
export type StoredEntry = Pick<
  typeof changeSetEntry.$inferSelect,
  'entityKind' | 'entityId' | 'before' | 'after'
> & { readonly op: string };

/**
 * What a companion revert did, plus the projection work to run once its transaction commits.
 *
 * @remarks
 * Search and document-image updates write through the database pool. Running them inside the
 * revert's transaction would wait on that transaction's own connection, which never frees on a
 * single-connection database, so they are handed back instead of run.
 */
export interface RevertResult {
  readonly outcome: UndoOutcome;
  readonly settle?: () => Promise<void>;
}

/** Whether another module reverses this entry kind. */
export function isCompanionKind(kind: string): boolean {
  return isLabelSetKind(kind) || isCatalogKind(kind);
}

/**
 * Reverse one companion entry inside a caller-owned transaction.
 *
 * @returns What happened, and the `settle` step the caller must run once its transaction commits.
 */
export function revertCompanionIn(
  entry: StoredEntry,
  orgId: string,
  tx: Tx,
): Promise<RevertResult> {
  return isCatalogKind(entry.entityKind)
    ? revertCatalogEntry(entry.entityKind, entry, orgId, tx)
    : revertLabelSet(entry, orgId, tx);
}

/**
 * Reverse one companion entry in its own transaction, then run its `settle` step.
 *
 * @param entry - The stored entry.
 * @param orgId - The organization it happened in.
 * @returns What happened to it.
 */
export async function revertCompanion(entry: StoredEntry, orgId: string): Promise<UndoOutcome> {
  const result = await db.transaction((tx) => revertCompanionIn(entry, orgId, tx));
  await result.settle?.();
  return result.outcome;
}
