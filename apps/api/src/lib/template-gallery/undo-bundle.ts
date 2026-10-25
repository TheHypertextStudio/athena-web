import {
  changeSet,
  changeSetEntry,
  template,
  workTemplateCopyBundle,
  workTemplateCopyEntry,
} from '@docket/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '../../error';
import type { UndoAccessCheck } from '../../mcp/change-set';
import type { TemplateActor } from '../templates/authorization';
import type { TemplateCopyBundleRow, TemplateCopyEntryRow } from '../templates/copy-reservation';
import type { TemplateTransaction } from '../templates/persistence';
import type { TemplateRow } from '../templates/model';
import { visibleTemplateWhere } from '../templates/visibility';

/** Lock the original acceptor-private bundle before entries or destination definitions. */
export async function lockTemplateCopyUndoBundle(
  tx: TemplateTransaction,
  actor: TemplateActor,
  receiptId: string,
): Promise<TemplateCopyBundleRow> {
  const [bundle] = await tx
    .select()
    .from(workTemplateCopyBundle)
    .where(
      and(
        eq(workTemplateCopyBundle.organizationId, actor.orgId),
        eq(workTemplateCopyBundle.acceptingActorKey, actor.actorId),
        eq(workTemplateCopyBundle.receiptKey, receiptId),
      ),
    )
    .for('update');
  if (!bundle) throw new NotFoundError('Change set not found');
  if (bundle.state === 'installing' || bundle.acceptingActorId !== actor.actorId)
    throw new ConflictError('Copy can no longer be undone');
  return bundle;
}

/** Compare only the exact original aggregate members; receipt attribution grants no access. */
function hasExactCopyEntries(
  recorded: readonly (typeof changeSetEntry.$inferSelect)[],
  entries: readonly TemplateCopyEntryRow[],
): boolean {
  const ids = new Set(entries.map((entry) => entry.destinationWorkTypeId));
  return (
    recorded.length === entries.length &&
    new Set(recorded.map((entry) => entry.entityId)).size === entries.length &&
    recorded.every(
      (entry) =>
        entry.entityKind === 'template' &&
        entry.op === 'create' &&
        entry.before === null &&
        entry.after !== null &&
        ids.has(entry.entityId),
    )
  );
}

/**
 * Lock and verify the exact immutable aggregate receipt rather than accepting a matching tool name.
 * @param guard - Recheck the adapter's live authority on these exact entries before Undo can mutate.
 */
export async function lockTemplateCopyUndoReceipt(
  tx: TemplateTransaction,
  bundle: TemplateCopyBundleRow,
  entries: readonly TemplateCopyEntryRow[],
  guard?: UndoAccessCheck,
): Promise<string> {
  if (!bundle.receiptKey) throw new ConflictError('Copy receipt is unavailable');
  const [receipt] = await tx
    .select()
    .from(changeSet)
    .where(
      and(eq(changeSet.organizationId, bundle.organizationId), eq(changeSet.id, bundle.receiptKey)),
    )
    .for('update');
  if (receipt?.actorId !== bundle.acceptingActorKey || bundle.receiptId !== receipt.id)
    throw new ConflictError('Copy receipt is unavailable');
  const recorded = await tx
    .select()
    .from(changeSetEntry)
    .where(eq(changeSetEntry.changeSetId, receipt.id));
  if (
    !hasExactCopyEntries(recorded, entries) ||
    (bundle.state === 'installed' && receipt.undoneAt !== null) ||
    (bundle.state === 'undone' && receipt.undoneAt === null)
  )
    throw new ConflictError('Copy receipt changed');
  if (guard) await guard(tx, recorded);
  return receipt.summary;
}

/** Lock concurrency epochs before targets, in the same destination order used by reference writers. */
export async function lockTemplateCopyUndoEntries(
  tx: TemplateTransaction,
  bundle: TemplateCopyBundleRow,
): Promise<TemplateCopyEntryRow[]> {
  return tx
    .select()
    .from(workTemplateCopyEntry)
    .where(
      and(
        eq(workTemplateCopyEntry.organizationId, bundle.organizationId),
        eq(workTemplateCopyEntry.bundleId, bundle.id),
      ),
    )
    .orderBy(asc(workTemplateCopyEntry.destinationWorkTypeId), asc(workTemplateCopyEntry.id))
    .for('update');
}

/** Check every current destination's visibility before tentative reversals; no hidden body is read. */
export async function lockTemplateCopyUndoTargets(
  tx: TemplateTransaction,
  actor: TemplateActor,
  entries: readonly TemplateCopyEntryRow[],
): Promise<ReadonlyMap<string, TemplateRow>> {
  const rows = await tx
    .select()
    .from(template)
    .where(
      and(
        visibleTemplateWhere(actor.orgId, actor.actorId, {
          includeArchived: true,
          includeBase: false,
        }),
        inArray(
          template.id,
          entries.map((entry) => entry.destinationWorkTypeId),
        ),
      ),
    )
    .orderBy(asc(template.id))
    .for('no key update');
  if (rows.length !== entries.length) throw new ConflictError('Copy can no longer be undone');
  return new Map(rows.map((row) => [row.id, row]));
}
