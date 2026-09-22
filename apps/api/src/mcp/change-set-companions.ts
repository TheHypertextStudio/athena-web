/**
 * `@docket/api` — the change-set entry kinds that `change-set.ts` hands off to other modules.
 *
 * @remarks
 * `change-set.ts` reverses work items and relations itself. Label-set snapshots and catalog rows
 * (labels, label groups, templates) have their own rules for reversal, and they live in
 * `change-set-labels.ts` and `change-set-catalog.ts`. This module is the one place that decides
 * which module an entry belongs to, so both undo paths dispatch the same way.
 */
import { db } from '@docket/db';

import type { UndoOutcome } from './change-set';
import { isCatalogKind, revertCatalogEntry } from './change-set-catalog';
import {
  isLabelSetKind,
  revertLabelSet,
  type RevertResult,
  type StoredEntry,
} from './change-set-labels';

/** A transaction handle. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Whether another module reverses this entry kind. */
export function isCompanionKind(kind: string): boolean {
  return isLabelSetKind(kind) || isCatalogKind(kind);
}

/** Reverse one companion entry inside `tx`. */
function revertIn(entry: StoredEntry, orgId: string, tx: Tx): Promise<RevertResult> {
  return isCatalogKind(entry.entityKind)
    ? revertCatalogEntry(entry.entityKind, entry, orgId, tx)
    : revertLabelSet(entry, orgId, tx);
}

/**
 * Reverse one entry that {@link isCompanionKind} claims.
 *
 * @remarks
 * Without `tx`, the revert runs in its own transaction and its search and image updates run once
 * that commits. With `tx`, the caller owns the commit and so owns those updates too. The atomic
 * undo path does not run them, which matches how it has always restored task labels.
 *
 * @param entry - The stored entry.
 * @param orgId - The organization it happened in.
 * @param tx - A caller-owned transaction.
 * @returns What happened to it.
 */
export async function revertCompanion(
  entry: StoredEntry,
  orgId: string,
  tx?: Tx,
): Promise<UndoOutcome> {
  if (tx) return (await revertIn(entry, orgId, tx)).outcome;
  const result = await db.transaction((own) => revertIn(entry, orgId, own));
  await result.settle?.();
  return result.outcome;
}
