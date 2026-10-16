import { changeSet, db, workTemplateCopyBundle, type TemplateCopyUndoOutcome } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import type { UndoOutcome } from '../../mcp/change-set';
import { ConflictError, NotFoundError } from '../../error';
import { requireTemplateAuthor } from '../templates/authorization';
import { templateChangeSetHasCopyBundle } from '../templates/copy-reference-integrity';
import { reconcileTemplateImages } from '../templates/images';
import { serializableTx } from '../serializable-tx';
import {
  templateCopyUndoContext,
  isTemplateCopyUndoEligible,
  type TemplateCopyUndoCaller,
} from './undo-context';
import {
  lockTemplateCopyUndoBundle,
  lockTemplateCopyUndoEntries,
  lockTemplateCopyUndoReceipt,
  lockTemplateCopyUndoTargets,
} from './undo-bundle';
import {
  applyTemplateCopyUndoStep,
  finishTemplateCopyUndo,
  templateCopyUndoSteps,
} from './undo-steps';

/** Existing receipt result, including terminal replay; copy-specific details remain private metadata. */
export interface TemplateCopyUndoResult {
  readonly summary: string;
  readonly outcomes: UndoOutcome[];
}

/** Internal routing discriminator only; it grants no destination, source or mutation authority. */
export async function isTemplateCopyChangeSet(orgId: string, receiptId: string): Promise<boolean> {
  return db.transaction((tx) => templateChangeSetHasCopyBundle(tx, orgId, receiptId));
}

/** Current-acceptor routing exception only; another person's private receipt gets ordinary adapter gates. */
export async function isOwnTemplateCopyChangeSet(
  caller: TemplateCopyUndoCaller,
  receiptId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await templateChangeSetHasCopyBundle(tx, caller.orgId, receiptId))) return false;
    if (!(await isTemplateCopyUndoEligible(tx, caller))) return false;
    const { actor } = await templateCopyUndoContext(tx, caller);
    const [bundle] = await tx
      .select({ id: workTemplateCopyBundle.id })
      .from(workTemplateCopyBundle)
      .where(
        and(
          eq(workTemplateCopyBundle.organizationId, actor.orgId),
          eq(workTemplateCopyBundle.acceptingActorKey, actor.actorId),
          eq(workTemplateCopyBundle.receiptKey, receiptId),
        ),
      )
      .limit(1);
    return bundle !== undefined;
  });
}

function publicOutcome(
  outcome: TemplateCopyUndoOutcome,
  ids: ReadonlyMap<string, string>,
): UndoOutcome {
  const id = ids.get(outcome.entryKey);
  if (!id) throw new ConflictError('Copy outcome is unavailable');
  return {
    kind: 'template',
    id,
    reverted: outcome.outcome === 'deleted' || outcome.outcome === 'archived',
    ...(outcome.outcome === 'retained_changed' ? { reason: 'changed_since' } : {}),
    ...(outcome.outcome === 'retained_in_use' ? { reason: 'in_use' } : {}),
  };
}

/**
 * Dispatch actual copy receipts before ordinary Undo filters; never use their recorded actor as authority.
 * @returns Null only for an ordinary receipt; a hidden or unauthorized registered copy fails closed.
 * @throws On changed membership/authoring, corrupt binding, concurrent reference conflict or missing caller.
 */
export async function tryUndoTemplateCopyChangeSet(
  orgId: string,
  receiptId: string,
  caller: TemplateCopyUndoCaller | undefined,
): Promise<TemplateCopyUndoResult | null> {
  const result = await serializableTx(async (tx) => {
    if (!(await templateChangeSetHasCopyBundle(tx, orgId, receiptId))) return null;
    if (caller?.orgId !== orgId) throw new NotFoundError('Change set not found');
    const { actor, principal } = await templateCopyUndoContext(tx, caller);
    const bundle = await lockTemplateCopyUndoBundle(tx, actor, receiptId);
    const entries = await lockTemplateCopyUndoEntries(tx, bundle);
    const summary = await lockTemplateCopyUndoReceipt(tx, bundle, entries);
    const ids = new Map(entries.map((entry) => [entry.entryKey, entry.destinationWorkTypeId]));
    if (bundle.state === 'undone') {
      if (!bundle.undoOutcomes) throw new ConflictError('Copy outcome is unavailable');
      return {
        summary,
        outcomes: bundle.undoOutcomes.map((outcome) => publicOutcome(outcome, ids)),
        effects: [],
      };
    }
    await requireTemplateAuthor(actor, tx);
    const rows = await lockTemplateCopyUndoTargets(tx, actor, entries);
    const steps = await templateCopyUndoSteps(tx, bundle, entries, rows);
    const byKey = new Map(entries.map((entry) => [entry.entryKey, entry]));
    const outcomes: TemplateCopyUndoOutcome[] = [];
    for (const step of steps) {
      const entry = byKey.get(step.entryKey);
      if (!entry) throw new ConflictError('Copy can no longer be undone');
      outcomes.push(
        await applyTemplateCopyUndoStep(tx, principal, {
          bundleId: bundle.id,
          entry,
          action: step.action,
        }),
      );
    }
    await finishTemplateCopyUndo(tx, bundle, outcomes);
    await tx
      .update(changeSet)
      .set({ undoneAt: new Date() })
      .where(and(eq(changeSet.organizationId, orgId), eq(changeSet.id, receiptId)));
    return {
      summary,
      outcomes: outcomes.map((outcome) => publicOutcome(outcome, ids)),
      effects: outcomes.flatMap((outcome) =>
        outcome.outcome === 'deleted' || outcome.outcome === 'archived'
          ? [{ id: publicOutcome(outcome, ids).id, deleted: outcome.outcome === 'deleted' }]
          : [],
      ),
    };
  });
  if (!result) return null;
  for (const effect of result.effects)
    await reconcileTemplateImages(orgId, effect.id, effect.deleted ? 'delete' : 'upsert');
  return { summary: result.summary, outcomes: result.outcomes };
}
